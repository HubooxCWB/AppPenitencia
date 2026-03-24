import { 
  Home, 
  Mountain, 
  BookOpen, 
  Target, 
  Trophy, 
  User, 
  Bell, 
  Plus, 
  ChevronRight, 
  ChevronDown, 
  CheckCircle2, 
  Circle,
  Search,
  Settings,
  LayoutDashboard,
  Users
} from 'lucide-react';

export type Screen =
  | 'LOGIN'
  | 'HOME'
  | 'SERRAS'
  | 'DIARIO'
  | 'METAS'
  | 'RANKING'
  | 'PERFIL'
  | 'MAINTENANCE'
  | 'CLOUD_SYNC_ERROR';

export interface User {
  id: string;
  name: string;
  username: string;
  email?: string;
  avatar: string;
  role: 'ADMIN' | 'USER';
}

export interface PeakCompletion {
  id: string;
  date: string;
  participants: string[];
  ownerUserId?: string | null;
  wikilocUrl?: string;
}

export type PeakCategory = 'PEAK' | 'WATERFALL';
export type LocalType = 'pico' | 'morro' | 'cachoeira' | 'trilha' | 'ilha';
export type SupportedState = 'Paraná';

export interface Peak {
  id: string;
  name: string;
  tipo_local: LocalType;
  altitude_metros: number | null;
  altura_queda_metros: number | null;
  estado: SupportedState;
  category?: PeakCategory;
  completions: PeakCompletion[];
}

export interface MountainRange {
  id: string;
  name: string;
  totalPeaks: number;
  completedPeaks: number;
  peaks: Peak[];
}

export interface Achievement {
  id: string;
  peakName: string;
  date: string;
  hikers: string[];
  imageUrl: string;
}

export interface Leader {
  id: string;
  name: string;
  peaks: number;
  rank: number;
  avatar: string;
  lastPeak?: string;
}

const PARANA_STATE: SupportedState = 'Paraná';
const createPeak = (
  id: string,
  name: string,
  tipo_local: LocalType,
  altitude_metros: number | null,
  altura_queda_metros: number | null = null,
): Peak => ({
  id,
  name,
  tipo_local,
  altitude_metros,
  altura_queda_metros,
  estado: PARANA_STATE,
  completions: [],
});

export const MOCK_MOUNTAIN_RANGES: MountainRange[] = [
  {
    id: 'serra-do-ibitiraquire',
    name: 'Serra do Ibitiraquire',
    totalPeaks: 12,
    completedPeaks: 0,
    peaks: [
      createPeak('pico-parana', 'Pico Paraná', 'pico', 1877),
      createPeak('pico-caratuva', 'Pico Caratuva', 'pico', 1860),
      createPeak('pico-itapiroca', 'Pico Itapiroca', 'pico', 1805),
      createPeak('pico-ferraria', 'Pico Ferraria', 'pico', 1579),
      createPeak('pico-taipabucu', 'Pico Taipabuçu', 'pico', 1580),
      createPeak('pico-tucum', 'Pico Tucum', 'pico', 1730),
      createPeak('pico-camapua', 'Pico Camapuã', 'pico', 1706),
      createPeak('cerro-verde', 'Cerro Verde', 'pico', 1550),
      createPeak('pico-ciririca', 'Pico Ciririca', 'pico', 1738),
      createPeak('morro-getulio', 'Morro Getúlio', 'morro', 1600),
      createPeak('morro-ferreiro', 'Morro Ferreiro', 'morro', 1600),
      createPeak('interagudos', 'Interagudos (Lontra, Cotia, Cuíca)', 'pico', 1650),
    ]
  },
  {
    id: 'serra-do-marumbi',
    name: 'Serra do Marumbi',
    totalPeaks: 10,
    completedPeaks: 0,
    peaks: [
      createPeak('caminho-do-itupava', 'Caminho do Itupava', 'trilha', null),
      createPeak('olimpo', 'Olimpo', 'pico', 1539),
      createPeak('boa-vista', 'Boa Vista', 'pico', 1500),
      createPeak('gigante', 'Gigante', 'pico', 1487),
      createPeak('ponta-do-tigre', 'Ponta do Tigre', 'pico', 1400),
      createPeak('esfinge', 'Esfinge', 'pico', 1450),
      createPeak('torre-dos-sinos', 'Torre dos Sinos', 'pico', 1450),
      createPeak('abrolhos', 'Abrolhos', 'pico', 1350),
      createPeak('facaozinho', 'Facãozinho', 'pico', 1300),
      createPeak('rochedinho', 'Rochedinho', 'pico', 1250),
    ]
  },
  {
    id: 'serra-da-baitaca',
    name: 'Serra da Baitaca',
    totalPeaks: 6,
    completedPeaks: 0,
    peaks: [
      createPeak('morro-anhangava', 'Morro Anhangava', 'morro', 1420),
      createPeak('morro-pao-de-loth', 'Morro Pão de Loth', 'morro', 1370),
      createPeak('morro-samambaia', 'Morro Samambaia', 'morro', 1340),
      createPeak('morro-do-canal', 'Morro do Canal', 'morro', 1360),
      createPeak('torre-amarela', 'Torre Amarela', 'pico', 1300),
      createPeak('morro-do-vigia', 'Morro do Vigia', 'morro', 1250),
      createPeak('salto-dos-macacos', 'Salto dos Macacos', 'cachoeira', 740, 70),
    ]
  },
  {
    id: 'serra-da-farinha-seca',
    name: 'Serra da Farinha Seca',
    totalPeaks: 7,
    completedPeaks: 0,
    peaks: [
      createPeak('morro-mae-catira', 'Morro Mãe Catira', 'morro', 1460),
      createPeak('morro-do-sete', 'Morro do Sete', 'morro', 1450),
      createPeak('morro-polegar', 'Morro Polegar', 'morro', 1380),
      createPeak('casfrei', 'Casfrei', 'pico', 1490),
      createPeak('esporao-do-vita', 'Esporão do Vita', 'morro', 1450),
      createPeak('tapapui', 'Tapapuí', 'morro', 1430),
      createPeak('tanguiri', 'Tanguiri', 'morro', 1410),
    ]
  },
  {
    id: 'serra-do-capivari',
    name: 'Serra do Capivari',
    totalPeaks: 3,
    completedPeaks: 0,
    peaks: [
      createPeak('capivari-grande', 'Pico Capivari Grande', 'pico', 1538),
      createPeak('capivari-medio', 'Pico Capivari Médio', 'pico', 1510),
      createPeak('capivari-mirim', 'Pico Capivari Mirim', 'pico', 1470),
    ]
  },
  {
    id: 'serra-da-papanduva',
    name: 'Serra da Papanduva',
    totalPeaks: 2,
    completedPeaks: 0,
    peaks: [
      createPeak('pico-aracatuba', 'Pico Araçatuba', 'pico', 1673),
      createPeak('morro-dos-perdidos', 'Morro dos Perdidos', 'morro', 1439),
    ]
  },
  {
    id: 'serra-da-prata',
    name: 'Serra da Prata',
    totalPeaks: 1,
    completedPeaks: 0,
    peaks: [
      createPeak('torre-da-prata', 'Torre da Prata', 'pico', 1500),
    ]
  },
  {
    id: 'serra-do-guaricana',
    name: 'Serra do Guaricana',
    totalPeaks: 1,
    completedPeaks: 0,
    peaks: [
      createPeak('morro-guaricana', 'Morro Guaricana', 'morro', 1540),
    ]
  },
  {
    id: 'serra-dos-agudos',
    name: 'Serra dos Agudos',
    totalPeaks: 10,
    completedPeaks: 0,
    peaks: [
      createPeak('pico-agudo-ybiangi', 'Pico Agudo (Ybiangi)', 'pico', 1224),
      createPeak('serra-grande', 'Serra Grande', 'pico', 1150),
      createPeak('pico-do-meio', 'Pico do Meio', 'pico', 1100),
      createPeak('serra-chata-morro-do-paredao', 'Serra Chata (Morro do Paredão)', 'pico', 1080),
      createPeak('pico-do-portal', 'Pico do Portal', 'pico', 1060),
      createPeak('morro-do-taff', 'Morro do Taff', 'morro', 1040),
      createPeak('morro-do-meio', 'Morro do Meio', 'morro', 1020),
      createPeak('calcanhar', 'Calcanhar', 'morro', 1000),
      createPeak('guarani', 'Guarani', 'morro', 980),
      createPeak('caviuna', 'Caviúna', 'morro', 950),
    ]
  },
  {
    id: 'campos-gerais-morros-isolados',
    name: 'Campos Gerais / Morros Isolados',
    totalPeaks: 5,
    completedPeaks: 0,
    peaks: [
      createPeak('morro-da-pedra-branca-ortigueira', 'Morro da Pedra Branca (Ortigueira)', 'morro', 1150),
      createPeak('morro-do-gaviao', 'Morro do Gavião', 'morro', 1100),
      createPeak('tres-morrinhos', 'Três Morrinhos', 'morro', 1080),
      createPeak('morro-do-cal', 'Morro do Cal', 'morro', 1020),
      createPeak('pedra-branca-do-araraquara', 'Pedra Branca do Araraquara', 'morro', 1200),
    ]
  },
  {
    id: 'ilhas',
    name: 'Ilhas',
    totalPeaks: 0,
    completedPeaks: 0,
    peaks: [
      createPeak('ilha-do-mel', 'Ilha do Mel', 'ilha', null),
      createPeak('ilha-das-pecas', 'Ilha das Peças', 'ilha', null),
    ]
  }
];
export const MOCK_ACHIEVEMENTS: Achievement[] = [];

export const MOCK_LEADERS: Leader[] = [
  {
    id: '1',
    name: 'Carlos Silva',
    peaks: 42,
    rank: 1,
    avatar: 'https://picsum.photos/seed/user1/200/200',
    lastPeak: 'Pico Paraná'
  },
  {
    id: '2',
    name: 'Ana Souza',
    peaks: 38,
    rank: 2,
    avatar: 'https://picsum.photos/seed/user2/200/200',
    lastPeak: 'Morro do Canal'
  },
  {
    id: '3',
    name: 'Beto Lima',
    peaks: 35,
    rank: 3,
    avatar: 'https://picsum.photos/seed/user3/200/200',
    lastPeak: 'Anhangava'
  },
  {
    id: '4',
    name: 'Mariana Costa',
    peaks: 31,
    rank: 4,
    avatar: 'https://picsum.photos/seed/user4/200/200',
    lastPeak: 'Pico Paraná'
  },
  {
    id: '5',
    name: 'Ricardo Mendes',
    peaks: 28,
    rank: 5,
    avatar: 'https://picsum.photos/seed/user5/200/200',
    lastPeak: 'Morro do Canal'
  },
  {
    id: '6',
    name: 'Julia Farias',
    peaks: 25,
    rank: 6,
    avatar: 'https://picsum.photos/seed/user6/200/200',
    lastPeak: 'Anhangava'
  },
  {
    id: '7',
    name: 'Fernando Luz',
    peaks: 22,
    rank: 7,
    avatar: 'https://picsum.photos/seed/user7/200/200',
    lastPeak: 'Pico Caratuva'
  }
];



