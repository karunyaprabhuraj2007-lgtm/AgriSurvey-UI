import { mockDb } from './mock-db';
import { NotificationJob, NotificationJobStatus } from '@/types';

export interface Msg91Config {
  authKey?: string;
  senderId?: string;
  templateId?: string;
  loginUrl?: string;
}

export interface SendApprovalSmsParams {
  phoneNumber: string;
  username: string;
  activationToken: string;
  applicationId: string;
  notificationId?: string;
  forceRetry?: boolean;
}

export class Msg91Service {
  private getConfig(): Msg91Config {
    const isBrowser = typeof window !== 'undefined';
    const env = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : {};
    
    // Security Guard (Module J): MSG91 Auth Key must never be embedded in browser client bundles
    const nodeEnv = typeof process !== 'undefined' && process.env ? process.env : {};
    const authKey = isBrowser ? undefined : (nodeEnv.MSG91_AUTH_KEY || env.MSG91_AUTH_KEY);

    return {
      authKey,
      senderId: env.MSG91_SENDER_ID || nodeEnv.MSG91_SENDER_ID || 'AGRSUR',
      templateId: env.MSG91_APPROVAL_TEMPLATE_ID || nodeEnv.MSG91_APPROVAL_TEMPLATE_ID,
      loginUrl:
        env.APP_LOGIN_URL ||
        env.VITE_APP_LOGIN_URL ||
        (isBrowser ? `${window.location.origin}/auth/login` : 'http://localhost:5173/auth/login'),
    };
  }

  public isConfigured(): boolean {
    const config = this.getConfig();
    return Boolean(config.authKey && config.templateId);
  }

  private maskPhone(phone: string): string {
    const clean = phone.replace(/\D/g, '');
    if (clean.length < 6) return '****';
    return `${clean.slice(0, 2)}****${clean.slice(-4)}`;
  }

  /**
   * Idempotent send or queue for farmer approval SMS via MSG91
   */
  async sendApprovalSms(params: {
    phoneNumber: string;
    username: string;
    activationToken: string;
    applicationId: string;
    notificationId?: string;
  }): Promise<{
    job: NotificationJob;
    activationUrl: string;
    messageText: string;
  }> {
    const config = this.getConfig();
    const cleanPhone = params.phoneNumber.replace(/\D/g, '');
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
    const activationUrl = `${origin}/auth/activate?token=${params.activationToken}`;
    const loginUrl = config.loginUrl || `${origin}/auth/login`;

    // Indian Regulatory Compliant Template Wording:
    const messageText = `AgriSurvey: Your farmer registration has been approved. Username: ${params.username}. Login: ${loginUrl}. Set your password securely using the official account activation process: ${activationUrl}`;

    // Idempotency check: see if a job already exists for this application
    const idempotencyKey = `msg91-approval-${params.applicationId}`;
    let existingJob = mockDb.notificationJobs.find(
      (j) => j.idempotency_key === idempotencyKey
    );

    if (existingJob && existingJob.delivery_status === 'SENT') {
      return { job: existingJob, activationUrl, messageText };
    }

    const jobId = existingJob?.id || `job-msg91-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const notificationId = params.notificationId || `notif-${Date.now()}`;

    // Initial state: PROCESSING
    const job: NotificationJob = {
      id: jobId,
      notification_id: notificationId,
      application_id: params.applicationId,
      provider: 'MSG91',
      recipient_phone: cleanPhone,
      template_id: config.templateId || 'UNCONFIGURED_TEMPLATE',
      idempotency_key: idempotencyKey,
      delivery_status: 'PROCESSING',
      attempt_count: (existingJob?.attempt_count || 0) + 1,
      last_attempt_at: new Date().toISOString(),
      delivered_at: null,
      provider_message_reference: null,
      error_code: null,
      error_details: null,
      created_at: existingJob?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!existingJob) {
      mockDb.notificationJobs.unshift(job);
    } else {
      Object.assign(existingJob, job);
    }

    // Check if real MSG91 credentials are provided
    if (!config.authKey || !config.templateId) {
      // Truthful: Credentials unavailable
      job.delivery_status = 'PROVIDER_UNAVAILABLE';
      job.error_code = 'MSG91_CREDENTIALS_MISSING';
      job.error_details = 'MSG91_AUTH_KEY or MSG91_APPROVAL_TEMPLATE_ID not configured in environment. SMS notification queued for retry.';
      job.updated_at = new Date().toISOString();

      mockDb.addAuditLog(
        'SMS_NOTIFICATION_PROVIDER_UNAVAILABLE',
        'notification_jobs',
        job.id,
        null,
        {
          recipient_masked: this.maskPhone(cleanPhone),
          reason: 'MSG91 credentials missing in environment',
          application_id: params.applicationId,
        }
      );

      mockDb.persistAll();
      return { job, activationUrl, messageText };
    }

    try {
      // Real API Call to MSG91 Flow endpoint
      const response = await fetch('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authkey: config.authKey,
        },
        body: JSON.stringify({
          template_id: config.templateId,
          sender: config.senderId,
          short_url: '0',
          recipients: [
            {
              mobiles: cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`,
              username: params.username,
              login_url: loginUrl,
              activation_url: activationUrl,
            },
          ],
        }),
      });

      const data = await response.json().catch(() => null);

      if (response.ok && data?.type === 'success') {
        job.delivery_status = 'SENT';
        job.provider_message_reference = data.message || `msg91-${Date.now()}`;
        job.delivered_at = new Date().toISOString();
        job.error_code = null;
        job.error_details = null;

        mockDb.addAuditLog('SMS_DISPATCHED_MSG91_SUCCESS', 'notification_jobs', job.id, null, {
          recipient_masked: this.maskPhone(cleanPhone),
          provider_ref: job.provider_message_reference,
        });
      } else {
        job.delivery_status = 'FAILED';
        job.error_code = data?.type || `HTTP_${response.status}`;
        job.error_details = data?.message || 'MSG91 API rejected submission request';

        mockDb.addAuditLog('SMS_DISPATCHED_MSG91_FAILED', 'notification_jobs', job.id, null, {
          recipient_masked: this.maskPhone(cleanPhone),
          status_code: response.status,
          error: job.error_details,
        });
      }
    } catch (err: any) {
      job.delivery_status = 'FAILED';
      job.error_code = 'NETWORK_ERROR';
      job.error_details = err.message || 'Network exception communicating with MSG91 gateway';
    }

    job.updated_at = new Date().toISOString();
    mockDb.persistAll();
    return { job, activationUrl, messageText };
  }

  /**
   * Secure retry for failed or unavailable notification jobs
   */
  async retryNotificationJob(jobId: string): Promise<NotificationJob> {
    const job = mockDb.notificationJobs.find((j) => j.id === jobId);
    if (!job) throw new Error('Notification job not found');

    if (!job.application_id || !job.recipient_phone) {
      throw new Error('Incomplete job metadata for retry');
    }

    const app = mockDb.applications.find((a) => a.id === job.application_id);
    if (!app) throw new Error('Related application not found');

    const farmer = mockDb.profiles.find((p) => p.id === app.farmer_id);
    if (!farmer) throw new Error('Related farmer profile not found');

    // Retrieve or recreate activation token
    let tokenRecord = mockDb.activationTokens.find(
      (t) => t.application_id === app.id && !t.used_at
    );

    const token = tokenRecord?.token || `act-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const res = await this.sendApprovalSms({
      phoneNumber: job.recipient_phone,
      username: farmer.generated_credentials?.username || farmer.phone_number || 'Farmer',
      activationToken: token,
      applicationId: app.id,
      notificationId: job.notification_id,
    });

    return res.job;
  }
}

export const msg91Service = new Msg91Service();
