// AgriSurvey System Constants

export const APP_NAME = 'AgriSurvey';
export const APP_TAGLINE = 'AI-Powered Smart Agriculture Administration & Land Verification Platform';

export const COLORS = {
  primaryBg: '#FFFFFF',
  secondaryBg: '#F8FAFC',
  primaryGreen: '#15803D',
  primaryTeal: '#0F766E',
  accentCyan: '#0891B2',
  lightMint: '#ECFDF5',
  paleCyan: '#ECFEFF',
  primaryText: '#0F172A',
  secondaryText: '#64748B',
  borders: '#E2E8F0',
  success: '#16A34A',
  warning: '#D97706',
  error: '#DC2626',
};

export const MAHARASHTRA_DISTRICTS = [
  'Pune',
  'Ahmednagar',
  'Solapur',
  'Satara',
  'Nashik',
  'Kolhapur',
  'Sangli',
  'Aurangabad',
];

export const PUNE_TALUKS = [
  'Haveli',
  'Baramati',
  'Shirur',
  'Daund',
  'Indapur',
  'Junnar',
  'Khed',
  'Ambegaon',
  'Bhor',
  'Maval',
  'Mulshi',
  'Purandar',
  'Velhe',
];

export const ACTIVE_PILOT_TALUKS = ['Haveli', 'Baramati', 'Shirur', 'Daund'] as const;

export const PUNE_SAMPLE_VILLAGES: Record<string, string[]> = {
  Haveli: ['Wagholi', 'Uruli Kanchan', 'Manjari', 'Hadapsar Rural', 'Loni Kalbhor', 'Khadakwasla', 'Khed Shivapur'],
  Baramati: ['Malegaon', 'Supae', 'Somanthali', 'Korhale', 'Deulgaon Rasal', 'Morgaon'],
  Shirur: ['Sanaswadi', 'Koregaon Bhima', 'Shikrapur', 'Pabal', 'Talegaon Dhamdhere', 'Nimgaon Mhalungi'],
  Daund: ['Kedgaon', 'Patas', 'Yavat', 'Varvand', 'Khamgaon'],
  Indapur: ['Bawda', 'Nimgaon Ketki', 'Anthurne', 'Palasdeo', 'Shetfal'],
};

export const LAND_AREA_UNITS = ['Acres', 'Hectares', 'Cents'] as const;

export const LAND_TYPES = [
  'Agricultural Land',
  'Irrigated Land',
  'Rain-Fed Land',
  'Mixed Agricultural Land',
  'Other',
] as const;

export const FARM_TYPES = [
  'Crop Farming',
  'Horticulture',
  'Plantation',
  'Mixed Farming',
  'Other',
] as const;

export const OWNERSHIP_CATEGORIES = [
  'Individual Ownership',
  'Joint Ownership',
  'Leasehold',
  'Other',
] as const;

export const CROPS_CATALOG = [
  { id: 'sugarcane', name: 'Sugarcane (ऊस)', category: 'Cash Crop', season: 'Annual', icon: '🎋' },
  { id: 'soybean', name: 'Soybean (सोयाबीन)', category: 'Oilseed', season: 'Kharif', icon: '🌱' },
  { id: 'onion', name: 'Onion (कांदा)', category: 'Vegetable / Cash', season: 'Rabi / Late Kharif', icon: '🧅' },
  { id: 'wheat', name: 'Wheat (गहू)', category: 'Cereal', season: 'Rabi', icon: '🌾' },
  { id: 'jowar', name: 'Jowar (ज्वारी)', category: 'Millet', season: 'Kharif / Rabi', icon: '🌾' },
  { id: 'bajra', name: 'Bajra (बाजरी)', category: 'Millet', season: 'Kharif', icon: '🌾' },
  { id: 'grapes', name: 'Grapes (द्राक्षे)', category: 'Horticulture', season: 'Perennial', icon: '🍇' },
  { id: 'pomegranate', name: 'Pomegranate (डाळिंब)', category: 'Horticulture', season: 'Perennial', icon: '🍎' },
  { id: 'cotton', name: 'Cotton (कापूस)', category: 'Fiber / Cash', season: 'Kharif', icon: '☁️' },
  { id: 'tomato', name: 'Tomato (टोमॅटो)', category: 'Vegetable', season: 'Multi-season', icon: '🍅' },
  { id: 'rice', name: 'Paddy Rice (भात)', category: 'Cereal', season: 'Kharif', icon: '🌾' },
];

export const CULTIVATION_SEASONS = [
  'Kharif (Monsoon)',
  'Rabi (Winter)',
  'Zaid (Summer)',
  'Perennial / Annual',
];

export const IRRIGATION_METHODS = [
  'Drip Irrigation',
  'Sprinkler Irrigation',
  'Canal / Flow Irrigation',
  'Borewell / Well Irrigation',
  'Rain-fed (No artificial irrigation)',
];
