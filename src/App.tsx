/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Home as HomeIcon, 
  Mountain, 
  MountainSnow,
  BookOpen, 
  Target, 
  Trophy, 
  User as UserIcon, 
  Bell, 
  Plus, 
  Search,
  Settings,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Circle,
  LayoutDashboard,
  Users,
  Lock,
  Mail,
  ArrowRight,
  Eye,
  EyeOff,
  LogOut,
  Calendar,
  Map as MapIcon,
  Pencil,
  Trash2,
  X,
  Download,
  Upload,
  AlertTriangle,
  CloudOff,
  RefreshCw,
  Wrench,
  Triangle,
  Waves,
  Route
} from 'lucide-react';
import { 
  Screen, 
  MOCK_MOUNTAIN_RANGES, 
  MountainRange,
  Leader,
  User,
  Peak,
  PeakCompletion,
  PeakCategory,
  LocalType
} from './types';
import {
  buildGeneratedAvatarUrl,
  CloudAppUser,
  CloudAuthProfile,
  CloudParticipantUser,
  deleteCloudCompletion,
  getMyCloudUser,
  isCloudSyncEnabled,
  isGeneratedAvatarUrl,
  listCloudUsers,
  listParticipantDirectory,
  loadRangesFromCloud,
  restoreSupabaseAuthProfile,
  saveRangesToCloud,
  signInWithSupabaseAuth,
  signOutSupabaseAuth,
  signUpWithSupabaseAuth,
  updateSupabaseAuthProfile,
  updateSupabaseAuthPassword,
  upsertCloudCompletion,
  upsertCloudUser,
} from './cloudSync';

const AUTH_STORAGE_KEY = 'penitencia-auth-user';
const MOUNTAIN_RANGES_STORAGE_KEY = 'penitencia-mountain-ranges';
const MOUNTAIN_RANGES_BACKUP_STORAGE_KEY = 'penitencia-mountain-ranges-backup';
const PARTICIPANT_DIRECTORY_STORAGE_KEY = 'penitencia-participant-directory';
const normalizeText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const repairPossiblyMojibake = (value: unknown) => {
  const text = String(value ?? '');
  if (!/[ÃÂ]/.test(text)) {
    return text;
  }

  try {
    return decodeURIComponent(escape(text));
  } catch {
    return text;
  }
};

const buildParticipantNameMap = (
  registeredUsers: CloudParticipantUser[],
  currentUser?: User | null,
) => {
  const participantNameMap = new Map<string, string>();
  const eligibleRegisteredUsers = registeredUsers.filter(registeredUser => registeredUser.role !== 'ADMIN');
  const registerName = (alias: unknown, displayName: unknown) => {
    const normalizedAlias = normalizeText(alias);
    const trimmedDisplayName = String(displayName ?? '').trim();
    if (!normalizedAlias || !trimmedDisplayName) {
      return;
    }

    participantNameMap.set(normalizedAlias, trimmedDisplayName);
  };

  eligibleRegisteredUsers.forEach(registeredUser => {
    registerName(registeredUser.display_name, registeredUser.display_name);
    registerName(registeredUser.username, registeredUser.display_name);
  });

  if (currentUser && currentUser.role !== 'ADMIN') {
    registerName(currentUser.name, currentUser.name);
    registerName(currentUser.username, currentUser.name);

    const email = String(currentUser.email ?? '').trim().toLowerCase();
    if (email.includes('@')) {
      registerName(email.split('@')[0], currentUser.name);
    }
  }

  return participantNameMap;
};

const buildParticipantAvatarMap = (
  registeredUsers: CloudParticipantUser[],
  currentUser?: User | null,
) => {
  const participantAvatarMap = new Map<string, string>();
  const registerAvatar = (alias: unknown, avatar: unknown) => {
    const normalizedAlias = normalizeText(alias);
    const trimmedAvatar = resolveSafeAvatarUrl(avatar);
    if (!normalizedAlias || !trimmedAvatar) {
      return;
    }

    participantAvatarMap.set(normalizedAlias, trimmedAvatar);
  };

  registeredUsers.filter(registeredUser => registeredUser.role !== 'ADMIN').forEach(registeredUser => {
    registerAvatar(registeredUser.display_name, registeredUser.avatar_url);
    registerAvatar(registeredUser.username, registeredUser.avatar_url);
  });

  if (currentUser && currentUser.role !== 'ADMIN') {
    registerAvatar(currentUser.name, currentUser.avatar);
    registerAvatar(currentUser.username, currentUser.avatar);

    const email = String(currentUser.email ?? '').trim().toLowerCase();
    if (email.includes('@')) {
      registerAvatar(email.split('@')[0], currentUser.avatar);
    }
  }

  return participantAvatarMap;
};

const buildAdminIdentityKeys = (
  registeredUsers: CloudParticipantUser[],
  currentUser?: User | null,
) => {
  const adminKeys = new Set<string>([
    'penitencia',
    'penitência',
  ]);
  const registerIdentity = (value: unknown) => {
    const normalizedValue = normalizeText(value);
    if (normalizedValue) {
      adminKeys.add(normalizedValue);
    }
  };

  registeredUsers
    .filter(registeredUser => registeredUser.role === 'ADMIN')
    .forEach(registeredUser => {
      registerIdentity(registeredUser.display_name);
      registerIdentity(registeredUser.username);
    });

  if (currentUser?.role === 'ADMIN') {
    registerIdentity(currentUser.name);
    registerIdentity(currentUser.username);
    const email = String(currentUser.email ?? '').trim().toLowerCase();
    if (email.includes('@')) {
      registerIdentity(email);
      registerIdentity(email.split('@')[0]);
    }
  }

  return adminKeys;
};

const mergeParticipantDirectoryUser = (
  currentRows: CloudParticipantUser[],
  nextRow: CloudParticipantUser,
) => {
  const nextUsernameKey = normalizeText(nextRow.username);
  const nextDisplayNameKey = normalizeText(nextRow.display_name);
  const filteredRows = currentRows.filter(row => (
    normalizeText(row.username) !== nextUsernameKey &&
    normalizeText(row.display_name) !== nextDisplayNameKey
  ));

  return [...filteredRows, nextRow].sort((a, b) =>
    String(a.display_name ?? a.username).localeCompare(String(b.display_name ?? b.username), 'pt-BR'),
  );
};

const resolveParticipantDisplayName = (
  participant: unknown,
  participantNameMap: Map<string, string>,
) => {
  const trimmedParticipant = String(participant ?? '').trim();
  if (!trimmedParticipant) {
    return '';
  }

  return participantNameMap.get(normalizeText(trimmedParticipant)) ?? trimmedParticipant;
};

const buildUserIdentityKeys = (
  currentUser?: User | null,
  participantNameMap?: Map<string, string>,
) => {
  if (!currentUser) {
    return [];
  }

  const email = String(currentUser.email ?? '').trim().toLowerCase();
  const emailLocalPart = email.includes('@') ? email.split('@')[0] ?? '' : '';
  const aliases = [
    currentUser.name,
    currentUser.username,
    email,
    emailLocalPart,
  ];

  if (participantNameMap) {
    aliases.push(
      resolveParticipantDisplayName(currentUser.name, participantNameMap),
      resolveParticipantDisplayName(currentUser.username, participantNameMap),
      resolveParticipantDisplayName(emailLocalPart, participantNameMap),
    );
  }

  return Array.from(new Set(aliases.map(alias => normalizeText(alias)).filter(Boolean)));
};

const doesCompletionBelongToUser = (
  completion: PeakCompletion,
  currentUser: User | null | undefined,
  userKeys: string[],
) => {
  if (!currentUser) {
    return false;
  }

  if (currentUser.role === 'ADMIN') {
    return true;
  }

  if (completion.ownerUserId && completion.ownerUserId === currentUser.id) {
    return true;
  }

  if (userKeys.length === 0 || !Array.isArray(completion.participants)) {
    return false;
  }

  return completion.participants.some(participant => userKeys.includes(normalizeText(participant)));
};

const getVisibleCompletionsForUser = (
  peak: Peak,
  currentUser: User | null | undefined,
  participantNameMap: Map<string, string>,
) => {
  const userKeys = buildUserIdentityKeys(currentUser, participantNameMap);
  return peak.completions.filter(completion => doesCompletionBelongToUser(completion, currentUser, userKeys));
};

const scopeMountainRangesForUser = (
  ranges: MountainRange[],
  currentUser: User | null | undefined,
  participantNameMap: Map<string, string>,
) =>
  ranges.map(range => {
    const peaks = (Array.isArray(range.peaks) ? range.peaks : []).map(peak => ({
      ...peak,
      completions: getVisibleCompletionsForUser(peak, currentUser, participantNameMap),
    }));
    const totalTargetPeaks = peaks.filter(peak => resolvePeakCategory(peak) === 'PEAK').length;
    const completedTargetPeaks = peaks.filter(
      peak => resolvePeakCategory(peak) === 'PEAK' && peak.completions.length > 0,
    ).length;

    return {
      ...range,
      peaks,
      totalPeaks: totalTargetPeaks,
      completedPeaks: completedTargetPeaks,
    };
  });

const sanitizeParticipants = (
  participants: string[],
  participantNameMap: Map<string, string>,
) =>
  Array.from(
    new Set(
      participants
        .map(participant => resolveParticipantDisplayName(participant, participantNameMap))
        .filter(Boolean),
    ),
  );

type CompletionGroup = {
  date: string;
  completions: PeakCompletion[];
  participants: string[];
};

const groupCompletionsByDate = (
  completions: PeakCompletion[],
  participantNameMap: Map<string, string>,
): CompletionGroup[] => {
  const groupsByDate = new Map<string, CompletionGroup>();

  completions.forEach(completion => {
    const date = completion.date || 'Sem data';
    const existingGroup = groupsByDate.get(date) ?? {
      date,
      completions: [],
      participants: [],
    };
    const participantSet = new Set(existingGroup.participants.map(participant => normalizeText(participant)));

    existingGroup.completions.push(completion);
    (Array.isArray(completion.participants) ? completion.participants : []).forEach(participant => {
      const displayName = resolveParticipantDisplayName(participant, participantNameMap);
      const participantKey = normalizeText(displayName);
      if (displayName && !participantSet.has(participantKey)) {
        existingGroup.participants.push(displayName);
        participantSet.add(participantKey);
      }
    });

    groupsByDate.set(date, existingGroup);
  });

  return Array.from(groupsByDate.values());
};

const sanitizeUsername = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .trim();

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result) {
        resolve(reader.result);
        return;
      }

      reject(new Error('Falha ao ler imagem.'));
    };
    reader.onerror = () => reject(new Error('Falha ao ler imagem.'));
    reader.readAsDataURL(file);
  });

const loadImageElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Falha ao carregar imagem.'));
    image.src = src;
  });

const buildOptimizedAvatarDataUrl = async (file: File, size = 512): Promise<string> => {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Falha ao preparar imagem.');
  }

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropSize = Math.min(sourceWidth, sourceHeight);
  const sourceX = Math.max(0, Math.floor((sourceWidth - cropSize) / 2));
  const sourceY = Math.max(0, Math.floor((sourceHeight - cropSize) / 2));

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, size, size);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    cropSize,
    cropSize,
    0,
    0,
    size,
    size,
  );

  return canvas.toDataURL('image/jpeg', 0.92);
};

const resolveSafeAvatarUrl = (avatarUrl: unknown) => {
  const avatar = String(avatarUrl ?? '').trim();
  return avatar.toLowerCase().includes('picsum.photos/') ? '' : avatar;
};

function AvatarImage({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className: string;
}) {
  const safeSrc = resolveSafeAvatarUrl(src);

  if (!safeSrc) {
    return (
      <div className={`${className} flex items-center justify-center bg-primary/10 text-primary`}>
        <UserIcon size={22} />
      </div>
    );
  }

  return (
    <img
      src={safeSrc}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
    />
  );
}

const mergeUserWithCloudDirectory = (
  baseUser: User,
  row: CloudAppUser | null | undefined,
): User => {
  if (!row) {
    return baseUser;
  }

  return {
    ...baseUser,
    name: String(row.display_name ?? '').trim() || baseUser.name,
    username: String(row.username ?? '').trim() || baseUser.username,
    email: String(row.email ?? '').trim() || baseUser.email,
    avatar: resolveSafeAvatarUrl(row.avatar_url) || resolveSafeAvatarUrl(baseUser.avatar),
    role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
  };
};

const toAppUserFromAuthProfile = (profile: CloudAuthProfile): User => ({
  id: profile.id,
  name: profile.displayName,
  username: profile.username,
  email: profile.email,
  avatar: resolveSafeAvatarUrl(profile.avatarUrl),
  role: profile.role,
});

interface LeaderTrailScore {
  id: string;
  name: string;
  rangeName: string;
  category: PeakCategory;
  localType: LocalType;
  altitude_metros: number | null;
}

interface LeaderCheckinDetail {
  id: string;
  name: string;
  rangeName: string;
  localType: LocalType;
  date: string;
  timestamp: number;
}

type RankingMode = 'PICOS' | 'ALTITUDE' | 'SERRAS' | 'CHECKINS' | 'GERAL';
type RankingLeader = Leader & {
  highestAltitude: number | null;
  highestAltitudePeak: string | null;
  altitudeTotal: number;
  exploredRangesCount: number;
  conqueredRangesCount: number;
  trilhasCount: number;
  cachoeirasCount: number;
  checkinsCount: number;
  score: number;
};

const FIXED_STATE = 'Paraná' as const;
const BAITACA_RANGE_ID = 'serra-da-baitaca';
const LOCAL_TYPE_LABELS: Record<LocalType, string> = {
  pico: 'Pico',
  morro: 'Morro',
  cachoeira: 'Cachoeira',
  trilha: 'Trilha',
  ilha: 'Ilha',
};
const LOCAL_TYPE_ORDER: Record<LocalType, number> = {
  pico: 1,
  morro: 2,
  trilha: 3,
  ilha: 4,
  cachoeira: 5,
};
const LOCAL_TYPE_SECTION_LABELS: Record<LocalType, string> = {
  pico: 'Picos',
  morro: 'Morros',
  trilha: 'Trilhas',
  ilha: 'Ilhas',
  cachoeira: 'Cachoeiras',
};
const LOCAL_TYPE_STYLES: Record<LocalType, {
  sectionTitleClass: string;
  cardCompletedClass: string;
  cardPendingClass: string;
  typeInfoClass: string;
  doneTextClass: string;
  actionEditButtonClass: string;
  actionAddButtonClass: string;
  completionBorderClass: string;
  completionDateClass: string;
  completionLinkClass: string;
  participantTagClass: string;
}> = {
  pico: {
    sectionTitleClass: 'text-primary',
    cardCompletedClass: 'bg-primary/10 border-primary/20',
    cardPendingClass: 'bg-primary/5 border-primary/15',
    typeInfoClass: 'text-primary/80',
    doneTextClass: 'text-primary',
    actionEditButtonClass: 'bg-primary/10 text-primary hover:bg-primary/20',
    actionAddButtonClass: 'bg-primary/20 text-primary hover:bg-primary/30',
    completionBorderClass: 'border-primary/10',
    completionDateClass: 'text-primary',
    completionLinkClass: 'text-primary',
    participantTagClass: 'bg-primary/5 text-primary/70 border-primary/10',
  },
  morro: {
    sectionTitleClass: 'text-emerald-300',
    cardCompletedClass: 'bg-emerald-500/10 border-emerald-400/30',
    cardPendingClass: 'bg-emerald-500/5 border-emerald-400/20',
    typeInfoClass: 'text-emerald-200/80',
    doneTextClass: 'text-emerald-300',
    actionEditButtonClass: 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
    actionAddButtonClass: 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30',
    completionBorderClass: 'border-emerald-400/10',
    completionDateClass: 'text-emerald-300',
    completionLinkClass: 'text-emerald-300',
    participantTagClass: 'bg-emerald-500/5 text-emerald-200 border-emerald-500/20',
  },
  trilha: {
    sectionTitleClass: 'text-cyan-300',
    cardCompletedClass: 'bg-cyan-500/10 border-cyan-400/30',
    cardPendingClass: 'bg-cyan-500/5 border-cyan-400/20',
    typeInfoClass: 'text-cyan-200/80',
    doneTextClass: 'text-cyan-300',
    actionEditButtonClass: 'bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20',
    actionAddButtonClass: 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30',
    completionBorderClass: 'border-cyan-400/10',
    completionDateClass: 'text-cyan-300',
    completionLinkClass: 'text-cyan-300',
    participantTagClass: 'bg-cyan-500/5 text-cyan-200 border-cyan-500/20',
  },
  ilha: {
    sectionTitleClass: 'text-teal-300',
    cardCompletedClass: 'bg-teal-500/10 border-teal-400/30',
    cardPendingClass: 'bg-teal-500/5 border-teal-400/20',
    typeInfoClass: 'text-teal-200/80',
    doneTextClass: 'text-teal-300',
    actionEditButtonClass: 'bg-teal-500/10 text-teal-300 hover:bg-teal-500/20',
    actionAddButtonClass: 'bg-teal-500/20 text-teal-300 hover:bg-teal-500/30',
    completionBorderClass: 'border-teal-400/10',
    completionDateClass: 'text-teal-300',
    completionLinkClass: 'text-teal-300',
    participantTagClass: 'bg-teal-500/5 text-teal-200 border-teal-500/20',
  },
  cachoeira: {
    sectionTitleClass: 'text-sky-300',
    cardCompletedClass: 'bg-sky-500/10 border-sky-400/30',
    cardPendingClass: 'bg-sky-500/5 border-sky-400/20',
    typeInfoClass: 'text-sky-200/80',
    doneTextClass: 'text-sky-300',
    actionEditButtonClass: 'bg-sky-500/10 text-sky-300 hover:bg-sky-500/20',
    actionAddButtonClass: 'bg-sky-500/20 text-sky-300 hover:bg-sky-500/30',
    completionBorderClass: 'border-sky-400/10',
    completionDateClass: 'text-sky-300',
    completionLinkClass: 'text-sky-300',
    participantTagClass: 'bg-sky-500/5 text-sky-200 border-sky-500/20',
  },
};
const BAITACA_ITEMS: Array<{ name: string, tipo_local: LocalType, altitude_metros: number | null, altura_queda_metros: number | null }> = [
  { name: 'Morro do Canal', tipo_local: 'morro', altitude_metros: 1360, altura_queda_metros: null },
  { name: 'Torre Amarela', tipo_local: 'pico', altitude_metros: 1300, altura_queda_metros: null },
  { name: 'Morro do Vigia', tipo_local: 'morro', altitude_metros: 1250, altura_queda_metros: null },
  { name: 'Salto dos Macacos', tipo_local: 'cachoeira', altitude_metros: 740, altura_queda_metros: 70 },
];
const INVALID_TEST_TRAIL_NAMES = new Set([
  'teste',
  'trilha teste',
  'teste trilha',
]);
const INVALID_TEST_PEAK_NAMES = new Set([
  'ttttttt',
]);
const BAITACA_ITEM_KEYS = new Set(BAITACA_ITEMS.map(item => normalizeText(item.name)));
const BAITACA_ITEM_BY_KEY = new Map(
  BAITACA_ITEMS.map(item => [normalizeText(item.name), item]),
);
const BASE_PEAK_RULES = new Map(
  MOCK_MOUNTAIN_RANGES.flatMap(range =>
    range.peaks.map(peak => [
      normalizeText(peak.name),
      {
        name: peak.name,
        tipo_local: peak.tipo_local,
        altitude_metros: peak.altitude_metros,
        altura_queda_metros: peak.altura_queda_metros,
      },
    ] as const),
  ),
);
[
  {
    aliases: ['Capivari Grande', 'Pico Capivari Grande'],
    data: {
      name: 'Pico Capivari Grande',
      tipo_local: 'pico' as LocalType,
      altitude_metros: 1538,
      altura_queda_metros: null as number | null,
    },
  },
  {
    aliases: ['Capivari Médio', 'Pico Capivari Médio'],
    data: {
      name: 'Pico Capivari Médio',
      tipo_local: 'pico' as LocalType,
      altitude_metros: 1510,
      altura_queda_metros: null as number | null,
    },
  },
  {
    aliases: ['Capivari Mirim', 'Pico Capivari Mirim'],
    data: {
      name: 'Pico Capivari Mirim',
      tipo_local: 'pico' as LocalType,
      altitude_metros: 1470,
      altura_queda_metros: null as number | null,
    },
  },
].forEach(rule => {
  rule.aliases.forEach(alias => {
    BASE_PEAK_RULES.set(normalizeText(alias), rule.data);
  });
});
const LOCAL_TYPES: LocalType[] = ['pico', 'morro', 'cachoeira', 'trilha', 'ilha'];
const LEGACY_CUME_TYPE = 'cume';
const ISLAND_RANGE_ID = 'ilhas';
const usesAltitudeByLocalType = (localType: LocalType) =>
  localType === 'pico' || localType === 'morro' || localType === 'cachoeira';
const getSuggestedLocalTypeForRange = (rangeId: string): LocalType => (
  rangeId === ISLAND_RANGE_ID ? 'ilha' : 'pico'
);
const isLocalType = (value: unknown): value is LocalType =>
  typeof value === 'string' && LOCAL_TYPES.includes(value as LocalType);
const resolvePeakLocalType = (
  peak: Pick<Peak, 'tipo_local' | 'category'> | null | undefined,
): LocalType => {
  const rawLocalType = normalizeText((peak as { tipo_local?: unknown } | null | undefined)?.tipo_local);
  if (rawLocalType === LEGACY_CUME_TYPE) {
    return 'pico';
  }

  if (isLocalType(rawLocalType)) {
    return rawLocalType;
  }

  return peak?.category === 'WATERFALL' ? 'cachoeira' : 'pico';
};
const resolvePeakCategory = (
  peak: Pick<Peak, 'tipo_local' | 'category'> | null | undefined,
): PeakCategory => (
  resolvePeakLocalType(peak) === 'cachoeira' ? 'WATERFALL' : 'PEAK'
);
const resolvePeakAltitude = (
  peak: Pick<Peak, 'altitude_metros'> | null | undefined,
): number | null => (
  typeof peak?.altitude_metros === 'number' ? peak.altitude_metros : null
);
const resolvePeakDropHeight = (
  peak: Pick<Peak, 'altura_queda_metros'> | null | undefined,
): number | null => (
  typeof peak?.altura_queda_metros === 'number' ? peak.altura_queda_metros : null
);
const getLocalTypeLabel = (localType: LocalType) => LOCAL_TYPE_LABELS[localType];
const getPeakLocalTypeLabel = (
  peak: Pick<Peak, 'tipo_local' | 'category'> | null | undefined,
) => getLocalTypeLabel(resolvePeakLocalType(peak));
const formatAltitude = (altitude: number | null | undefined) => (
  typeof altitude === 'number' ? `${altitude} m` : 'Sem altitude'
);
const formatPeakMeta = (
  peak: Pick<Peak, 'tipo_local' | 'category' | 'altitude_metros' | 'altura_queda_metros'> | null | undefined,
) => {
  const localType = resolvePeakLocalType(peak);
  const dropHeight = resolvePeakDropHeight(peak);
  const altitude = resolvePeakAltitude(peak);

  if (localType === 'trilha' || localType === 'ilha') {
    return getPeakLocalTypeLabel(peak);
  }

  if (localType === 'cachoeira' && typeof dropHeight === 'number') {
    return typeof altitude === 'number'
      ? `${getPeakLocalTypeLabel(peak)} • ${formatAltitude(altitude)} • queda ${dropHeight} m`
      : `${getPeakLocalTypeLabel(peak)} • queda ${dropHeight} m`;
  }

  return `${getPeakLocalTypeLabel(peak)} • ${formatAltitude(altitude)}`;
};
const GLOSSARY_ITEMS: Array<{ term: string; description: string }> = [
  {
    term: 'Pico',
    description: 'Cume destacado de uma montanha ou ponto mais alto de uma elevação.',
  },
  {
    term: 'Morro',
    description: 'Elevação natural tradicionalmente chamada de morro. Muitos morros também possuem trilhas de montanhismo.',
  },
  {
    term: 'Trilha',
    description: 'Caminho utilizado para trekking ou acesso a montanhas.',
  },
  {
    term: 'Ilha',
    description: 'Destino insular de exploração, normalmente sem altitude cadastrada.',
  },
  {
    term: 'Cachoeira',
    description: 'Queda d\'água natural visitada em trilhas ou montanhas.',
  },
];

const slugifyText = (value: string) =>
  normalizeText(value)
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null
);

const toBRDate = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = repairPossiblyMojibake(value).trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-');
    return `${day}/${month}/${year}`;
  }

  const parsedDate = new Date(trimmed);
  if (!Number.isNaN(parsedDate.getTime())) {
    const day = String(parsedDate.getDate()).padStart(2, '0');
    const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
    const year = String(parsedDate.getFullYear());
    return `${day}/${month}/${year}`;
  }

  return null;
};

const toParticipantList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map(participant => repairPossiblyMojibake(participant).trim())
          .filter(Boolean),
      ),
    );
  }

  if (typeof value === 'string') {
    return Array.from(
      new Set(
        repairPossiblyMojibake(value)
          .split(/[;,]/)
          .map(participant => participant.trim())
          .filter(Boolean),
      ),
    );
  }

  return [];
};

const hasLegacyCheckedFlag = (record: Record<string, unknown>) => (
  record.checked === true ||
  record.check === true ||
  record.completed === true ||
  record.isChecked === true ||
  record.done === true
);

const normalizePeakCompletions = (peak: Peak): PeakCompletion[] => {
  const peakRecord = asRecord(peak) ?? {};
  const peakId = typeof peak.id === 'string' && peak.id.trim() ? peak.id : 'local';
  const today = new Date();
  const fallbackDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  const completionSources: unknown[] = [];

  const rawCompletions = peakRecord.completions;
  if (Array.isArray(rawCompletions)) {
    completionSources.push(...rawCompletions);
  }

  const rawChecks = peakRecord.checks;
  if (Array.isArray(rawChecks)) {
    completionSources.push(...rawChecks);
  }

  const normalizedCompletions = completionSources
    .map<PeakCompletion | null>((completion, index) => {
      const completionRecord = asRecord(completion);
      if (!completionRecord) {
        return null;
      }

      const date = toBRDate(
        completionRecord.date ??
        completionRecord.data ??
        completionRecord.completedAt ??
        completionRecord.checkedAt,
      ) ?? fallbackDate;

      const participants = toParticipantList(
        completionRecord.participants ??
        completionRecord.participantes ??
        completionRecord.hikers,
      );
      const ownerUserId = typeof completionRecord.ownerUserId === 'string' && completionRecord.ownerUserId.trim()
        ? completionRecord.ownerUserId.trim()
        : typeof completionRecord.owner_user_id === 'string' && completionRecord.owner_user_id.trim()
          ? completionRecord.owner_user_id.trim()
          : null;

      const wikilocCandidate = completionRecord.wikilocUrl ?? completionRecord.wikiloc;
      const wikilocUrl = typeof wikilocCandidate === 'string' && wikilocCandidate.trim()
        ? wikilocCandidate.trim()
        : undefined;

      const idCandidate = completionRecord.id;
      const id = typeof idCandidate === 'string' && idCandidate.trim()
        ? idCandidate.trim()
        : `${peakId}-completion-${index + 1}`;

      const hasMeaningfulData =
        participants.length > 0 ||
        Boolean(wikilocUrl) ||
        hasLegacyCheckedFlag(completionRecord) ||
        Boolean(toBRDate(
          completionRecord.date ??
          completionRecord.data ??
          completionRecord.completedAt ??
          completionRecord.checkedAt,
        ));

      if (!hasMeaningfulData) {
        return null;
      }

      return {
        id,
        date,
        participants,
        ...(ownerUserId ? { ownerUserId } : {}),
        ...(wikilocUrl ? { wikilocUrl } : {}),
      };
    })
    .filter((completion): completion is PeakCompletion => completion !== null);

  if (normalizedCompletions.length === 0 && hasLegacyCheckedFlag(peakRecord)) {
    normalizedCompletions.push({
      id: `${peakId}-legacy-check`,
      date: toBRDate(
        peakRecord.date ??
        peakRecord.data ??
        peakRecord.completedAt ??
        peakRecord.checkedAt,
      ) ?? fallbackDate,
      participants: toParticipantList(
        peakRecord.participants ??
        peakRecord.participantes ??
        peakRecord.hikers,
      ),
      wikilocUrl: typeof peakRecord.wikilocUrl === 'string' && peakRecord.wikilocUrl.trim()
        ? peakRecord.wikilocUrl.trim()
        : typeof peakRecord.wikiloc === 'string' && peakRecord.wikiloc.trim()
          ? peakRecord.wikiloc.trim()
          : undefined,
    });
  }

  const completionsById = new Map<string, PeakCompletion>();
  normalizedCompletions.forEach(completion => {
    completionsById.set(completion.id, completion);
  });

  return Array.from(completionsById.values());
};

const cloneRanges = (ranges: MountainRange[]): MountainRange[] =>
  ranges.map<MountainRange>(range => ({
    ...range,
    id: normalizeText(range.id) === 'ilha' ? ISLAND_RANGE_ID : range.id,
    name: normalizeText(range.name) === 'ilha' ? 'Ilhas' : repairPossiblyMojibake(range.name),
    peaks: Array.isArray(range.peaks)
      ? range.peaks.map<Peak>(peak => {
          const repairedPeakName = repairPossiblyMojibake(peak.name);
          const normalizedPeakName = normalizeText(repairedPeakName);
          const basePeakData = BASE_PEAK_RULES.get(normalizedPeakName);
          const localType = basePeakData?.tipo_local ?? resolvePeakLocalType(peak);
          const category: PeakCategory = localType === 'cachoeira' ? 'WATERFALL' : 'PEAK';

          return {
            ...peak,
            name: basePeakData?.name ?? repairedPeakName,
            tipo_local: localType,
            altitude_metros: basePeakData?.altitude_metros ?? resolvePeakAltitude(peak),
            altura_queda_metros: basePeakData?.altura_queda_metros ?? resolvePeakDropHeight(peak),
            estado: FIXED_STATE,
            category,
            completions: normalizePeakCompletions(peak),
          };
        })
      : [],
  }));

const mergePeakCompletions = (...completionGroups: PeakCompletion[][]) => {
  const completionsById = new Map<string, PeakCompletion>();
  const completionsWithoutId: PeakCompletion[] = [];

  completionGroups.flat().forEach(completion => {
    if (!completion || typeof completion !== 'object') {
      return;
    }

    if (typeof completion.id === 'string' && completion.id.trim()) {
      completionsById.set(completion.id, completion);
      return;
    }

    completionsWithoutId.push(completion);
  });

  return [...completionsById.values(), ...completionsWithoutId];
};

const withRangeStats = (ranges: MountainRange[]) =>
  ranges.map(range => {
    const peaks = Array.isArray(range.peaks) ? range.peaks : [];
    const mountainPeaks = peaks.filter(peak => resolvePeakCategory(peak) === 'PEAK');

    return {
      ...range,
      peaks,
      totalPeaks: mountainPeaks.length,
      completedPeaks: mountainPeaks.filter(peak => peak.completions.length > 0).length,
    };
  });

const migrateBaitacaPeaks = (ranges: MountainRange[]) => {
  const nextRanges = cloneRanges(ranges);
  const baitacaIndex = nextRanges.findIndex(range => range.id === BAITACA_RANGE_ID);
  if (baitacaIndex === -1) {
    return withRangeStats(nextRanges);
  }

  const collectedBaitacaItems = new Map<string, Peak>();

  nextRanges.forEach((range, rangeIndex) => {
    const remainingPeaks: Peak[] = [];

    range.peaks.forEach(peak => {
      const itemKey = normalizeText(peak.name);

      if (!BAITACA_ITEM_KEYS.has(itemKey)) {
        remainingPeaks.push(peak);
        return;
      }

      const baitacaItem = BAITACA_ITEM_BY_KEY.get(itemKey);
      if (!baitacaItem) {
        remainingPeaks.push(peak);
        return;
      }

      const existingItem = collectedBaitacaItems.get(itemKey);

      collectedBaitacaItems.set(itemKey, {
        id: existingItem?.id || peak.id || slugifyText(baitacaItem.name),
        name: baitacaItem.name,
        tipo_local: baitacaItem.tipo_local,
        altitude_metros: baitacaItem.altitude_metros,
        altura_queda_metros: baitacaItem.altura_queda_metros,
        estado: FIXED_STATE,
        category: baitacaItem.tipo_local === 'cachoeira' ? 'WATERFALL' : 'PEAK',
        completions: mergePeakCompletions(existingItem?.completions ?? [], peak.completions),
      });
    });

    nextRanges[rangeIndex] = {
      ...range,
      peaks: remainingPeaks,
    };
  });

  const baitacaRange = nextRanges[baitacaIndex];
  const baitacaPeaks = [...baitacaRange.peaks];

  BAITACA_ITEMS.forEach(item => {
    const itemKey = normalizeText(item.name);
    const existingIndex = baitacaPeaks.findIndex(
      existingPeak => normalizeText(existingPeak.name) === itemKey,
    );
    const collectedItem = collectedBaitacaItems.get(itemKey);

    if (existingIndex >= 0) {
      const existingPeak = baitacaPeaks[existingIndex];
      baitacaPeaks[existingIndex] = {
        ...existingPeak,
        id: existingPeak.id || collectedItem?.id || slugifyText(item.name),
        name: item.name,
        tipo_local: item.tipo_local,
        altitude_metros: item.altitude_metros,
        altura_queda_metros: item.altura_queda_metros,
        estado: FIXED_STATE,
        category: item.tipo_local === 'cachoeira' ? 'WATERFALL' : 'PEAK',
        completions: mergePeakCompletions(existingPeak.completions, collectedItem?.completions ?? []),
      };
      return;
    }

    baitacaPeaks.push({
      id: collectedItem?.id || slugifyText(item.name),
      name: item.name,
      tipo_local: item.tipo_local,
      altitude_metros: item.altitude_metros,
      altura_queda_metros: item.altura_queda_metros,
      estado: FIXED_STATE,
      category: item.tipo_local === 'cachoeira' ? 'WATERFALL' : 'PEAK',
      completions: mergePeakCompletions(collectedItem?.completions ?? []),
    });
  });

  nextRanges[baitacaIndex] = {
    ...baitacaRange,
    peaks: baitacaPeaks,
  };

  return withRangeStats(nextRanges);
};

const removeInvalidTestTrails = (ranges: MountainRange[]) => {
  const cleanedRanges = cloneRanges(ranges).map(range => ({
    ...range,
    peaks: range.peaks.filter(peak => {
      const isTrail = resolvePeakLocalType(peak) === 'trilha';
      const isInvalidTestTrail = INVALID_TEST_TRAIL_NAMES.has(normalizeText(peak.name));
      const isPeak = resolvePeakLocalType(peak) === 'pico';
      const isInvalidTestPeak = INVALID_TEST_PEAK_NAMES.has(normalizeText(peak.name));
      return !((isTrail && isInvalidTestTrail) || (isPeak && isInvalidTestPeak));
    }),
  }));

  return withRangeStats(cleanedRanges);
};

const normalizeMountainRanges = (ranges: MountainRange[]) =>
  removeInvalidTestTrails(migrateBaitacaPeaks(ranges));

const parseBackupRanges = (rawBackup: unknown): MountainRange[] | null => {
  if (Array.isArray(rawBackup)) {
    return rawBackup as MountainRange[];
  }

  const backupRecord = asRecord(rawBackup);
  if (!backupRecord) {
    return null;
  }

  const candidates: unknown[] = [
    backupRecord.mountainRanges,
    backupRecord.ranges,
    backupRecord[MOUNTAIN_RANGES_STORAGE_KEY],
    backupRecord.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as MountainRange[];
    }
  }

  return null;
};

const readStoredMountainRanges = (storageKey: string): MountainRange[] | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? (parsedValue as MountainRange[]) : null;
  } catch {
    return null;
  }
};

const getTotalCompletions = (ranges: MountainRange[]) =>
  ranges.reduce(
    (acc, range) => acc + range.peaks.reduce((peakAcc, peak) => peakAcc + peak.completions.length, 0),
    0,
  );

const getPreferredStoredRanges = (): MountainRange[] | null => {
  const savedRanges = readStoredMountainRanges(MOUNTAIN_RANGES_STORAGE_KEY);
  const backupRanges = readStoredMountainRanges(MOUNTAIN_RANGES_BACKUP_STORAGE_KEY);

  if (savedRanges && backupRanges) {
    const savedHasCompletions = getTotalCompletions(savedRanges) > 0;
    const backupHasCompletions = getTotalCompletions(backupRanges) > 0;
    return !savedHasCompletions && backupHasCompletions ? backupRanges : savedRanges;
  }

  if (savedRanges) {
    return savedRanges;
  }

  if (backupRanges) {
    return backupRanges;
  }

  return null;
};

const readStoredParticipantDirectory = (): CloudParticipantUser[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(PARTICIPANT_DIRECTORY_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsedValue) ? (parsedValue as CloudParticipantUser[]) : [];
  } catch {
    return [];
  }
};

const resolveCloudAvatarForPersistence = (avatarUrl: string | undefined, username: string) => {
  const trimmedAvatar = String(avatarUrl ?? '').trim();
  if (!trimmedAvatar || isGeneratedAvatarUrl(trimmedAvatar, username)) {
    return undefined;
  }

  return trimmedAvatar;
};

const persistParticipantDirectory = (rows: CloudParticipantUser[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(PARTICIPANT_DIRECTORY_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Ignore cache write failures and keep the in-memory list.
  }
};

export default function App() {
  const cloudSyncEnabled = isCloudSyncEnabled();
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const savedUser = window.localStorage.getItem(AUTH_STORAGE_KEY);
      return savedUser ? (JSON.parse(savedUser) as User) : null;
    } catch {
      return null;
    }
  });
  const [currentScreen, setCurrentScreen] = useState<Screen>('HOME');
  const [mountainRanges, setMountainRanges] = useState<MountainRange[]>(() => {
    if (cloudSyncEnabled) {
      return normalizeMountainRanges(getPreferredStoredRanges() ?? MOCK_MOUNTAIN_RANGES);
    }

    return normalizeMountainRanges(getPreferredStoredRanges() ?? MOCK_MOUNTAIN_RANGES);
  });
  const [isAuthBootstrapping, setIsAuthBootstrapping] = useState(cloudSyncEnabled);
  const [isPasswordChangeRequired, setIsPasswordChangeRequired] = useState(false);
  const [isCloudBootstrapping, setIsCloudBootstrapping] = useState(false);
  const [cloudBootstrapRetryKey, setCloudBootstrapRetryKey] = useState(0);
  const [cloudSyncErrorStatus, setCloudSyncErrorStatus] = useState<number | null>(null);
  const [registeredUsers, setRegisteredUsers] = useState<CloudParticipantUser[]>(() => readStoredParticipantDirectory());
  const [isLoadingRegisteredUsers, setIsLoadingRegisteredUsers] = useState(false);
  const [isSavingCompletion, setIsSavingCompletion] = useState(false);
  const [completionSyncStatus, setCompletionSyncStatus] = useState<{
    state: 'idle' | 'saving' | 'success' | 'error';
    message: string;
  }>({ state: 'idle', message: '' });
  const completionSyncStatusTimeoutRef = useRef<number | null>(null);
  const hadCachedUserOnLoad = useRef(Boolean(user));
  const hasInitializedMountainRangesPersistence = useRef(false);
  const hasAttemptedCloudHydration = useRef(false);
  const hasHydratedCloudRanges = useRef(!cloudSyncEnabled);
  const [isAddingRange, setIsAddingRange] = useState(false);
  const [isAddingPeak, setIsAddingPeak] = useState<{ rangeId: string } | null>(null);
  const [isEditingPeak, setIsEditingPeak] = useState<{ rangeId: string, peak: Peak } | null>(null);
  const [isCompletingPeak, setIsCompletingPeak] = useState<{ 
    rangeId: string, 
    peak: Peak, 
    completionId?: string,
    initialData?: { date: string, participants: string[], wikilocUrl?: string },
    isReadOnly?: boolean,
  } | null>(null);
  const participantNameMap = buildParticipantNameMap(registeredUsers, user);
  const participantAvatarMap = buildParticipantAvatarMap(registeredUsers, user);
  const adminIdentityKeys = buildAdminIdentityKeys(registeredUsers, user);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (user) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
      return;
    }

    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }, [user]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isSavingCompletion) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isSavingCompletion]);

  useEffect(() => () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (completionSyncStatusTimeoutRef.current !== null) {
      window.clearTimeout(completionSyncStatusTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!cloudSyncEnabled) {
      setIsAuthBootstrapping(false);
      setCloudSyncErrorStatus(null);
      return;
    }

    let isCancelled = false;

    const bootstrapAuth = async () => {
      try {
        const authProfile = await restoreSupabaseAuthProfile();
        if (isCancelled) {
          return;
        }

        if (!authProfile) {
          if (hadCachedUserOnLoad.current && user) {
            setCurrentScreen('HOME');
            return;
          }

          setUser(null);
          setCurrentScreen('LOGIN');
          return;
        }

        const baseUser = toAppUserFromAuthProfile(authProfile);
        const syncedUser = baseUser.email
          ? await upsertCloudUser({
              authUserId: baseUser.id,
              email: baseUser.email,
              username: baseUser.username,
              displayName: baseUser.name,
              avatarUrl: resolveCloudAvatarForPersistence(baseUser.avatar, baseUser.username),
            })
          : await getMyCloudUser();
        const mappedUser = mergeUserWithCloudDirectory(baseUser, syncedUser);
        setUser(mappedUser);
        setCurrentScreen('HOME');
        setIsPasswordChangeRequired(false);
      } finally {
        if (!isCancelled) {
          setIsAuthBootstrapping(false);
        }
      }
    };

    void bootstrapAuth();

    return () => {
      isCancelled = true;
    };
  }, [cloudSyncEnabled]);

  useEffect(() => {
    if (!cloudSyncEnabled || !user) {
      setRegisteredUsers(readStoredParticipantDirectory());
      setIsLoadingRegisteredUsers(false);
      return;
    }

    let isCancelled = false;

    const loadRegisteredUsers = async () => {
      setIsLoadingRegisteredUsers(true);
      const rows = await listParticipantDirectory();
      if (!isCancelled) {
        if (Array.isArray(rows) && rows.length > 0) {
          setRegisteredUsers(rows);
          persistParticipantDirectory(rows);
        } else {
          setRegisteredUsers(currentRows => (
            currentRows.length > 0 ? currentRows : readStoredParticipantDirectory()
          ));
        }
        setIsLoadingRegisteredUsers(false);
      }
    };

    void loadRegisteredUsers();
    return () => {
      isCancelled = true;
    };
  }, [cloudSyncEnabled, user]);

  useEffect(() => {
    if (!hasInitializedMountainRangesPersistence.current) {
      hasInitializedMountainRangesPersistence.current = true;
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const previousRangesJson = window.localStorage.getItem(MOUNTAIN_RANGES_STORAGE_KEY);
    const nextRangesJson = JSON.stringify(mountainRanges);
    if (previousRangesJson) {
      window.localStorage.setItem(MOUNTAIN_RANGES_BACKUP_STORAGE_KEY, previousRangesJson);
    }

    window.localStorage.setItem(MOUNTAIN_RANGES_STORAGE_KEY, nextRangesJson);

    if (cloudSyncEnabled && user?.role === 'ADMIN') {
      if (!hasHydratedCloudRanges.current) {
        return;
      }

      void saveRangesToCloud(mountainRanges);
    }
  }, [cloudSyncEnabled, mountainRanges, user?.role]);

  // Hydrate from cloud only after auth bootstrap and when user is set, so the request uses the user session.
  useEffect(() => {
    if (typeof window === 'undefined') {
      setIsCloudBootstrapping(false);
      return;
    }

    if (!cloudSyncEnabled || isAuthBootstrapping) {
      if (!cloudSyncEnabled) setIsCloudBootstrapping(false);
      return;
    }

    // Wait for login so loadRangesFromCloud uses the session token (Vercel has session; localhost was loading before login with anon).
    if (!user) {
      hasAttemptedCloudHydration.current = false;
      setCloudSyncErrorStatus(null);
      return;
    }

    if (hasAttemptedCloudHydration.current) {
      return;
    }
    hasAttemptedCloudHydration.current = true;

    setIsCloudBootstrapping(true);

    let isCancelled = false;
    const bootstrapWatchdog = window.setTimeout(() => {
      if (!isCancelled) {
        hasHydratedCloudRanges.current = true;
        setIsCloudBootstrapping(false);
      }
    }, 12000);

    const hydrateFromCloud = async () => {
      try {
        const cloudLoad = await loadRangesFromCloud();
        if (isCancelled) {
          return;
        }

        if (cloudLoad.status === 'ok') {
          const normalizedCloudRanges = normalizeMountainRanges(cloudLoad.ranges);
          setMountainRanges(normalizedCloudRanges);
          hasHydratedCloudRanges.current = true;
          setCloudSyncErrorStatus(null);
          setIsCloudBootstrapping(false);
          setCurrentScreen(current =>
            current === 'MAINTENANCE' || current === 'CLOUD_SYNC_ERROR' ? 'HOME' : current,
          );
          return;
        }

        if (cloudLoad.status === 'error') {
          const localRanges = getPreferredStoredRanges();
          if (localRanges) {
            setMountainRanges(normalizeMountainRanges(localRanges));
            hasHydratedCloudRanges.current = true;
            setCloudSyncErrorStatus(cloudLoad.httpStatus ?? null);
            setIsCloudBootstrapping(false);
            return;
          }

          if (mountainRanges.length > 0) {
            hasHydratedCloudRanges.current = true;
            setCloudSyncErrorStatus(cloudLoad.httpStatus ?? null);
            setIsCloudBootstrapping(false);
            return;
          }

          hasHydratedCloudRanges.current = true;
          setCloudSyncErrorStatus(cloudLoad.httpStatus ?? null);
          setIsCloudBootstrapping(false);
          setCurrentScreen(
            cloudLoad.httpStatus === 502 || cloudLoad.httpStatus === 503 || cloudLoad.httpStatus === 504
              ? 'MAINTENANCE'
              : 'CLOUD_SYNC_ERROR',
          );
          return;
        }

        // One-time migration path: if cloud is empty, push existing local data (if any).
        const localRanges = getPreferredStoredRanges();
        if (localRanges) {
          const normalizedLocalRanges = normalizeMountainRanges(localRanges);
          setMountainRanges(normalizedLocalRanges);
          hasHydratedCloudRanges.current = true;
          setCloudSyncErrorStatus(null);
          setIsCloudBootstrapping(false);
          if (user.role === 'ADMIN') {
            void saveRangesToCloud(normalizedLocalRanges);
          }
          return;
        }

        const normalizedMockRanges = normalizeMountainRanges(MOCK_MOUNTAIN_RANGES);
        setMountainRanges(normalizedMockRanges);
        hasHydratedCloudRanges.current = true;
        setCloudSyncErrorStatus(null);
        setIsCloudBootstrapping(false);
        if (user.role === 'ADMIN') {
          void saveRangesToCloud(normalizedMockRanges);
        }
      } catch {
        if (!isCancelled) {
          const localRanges = getPreferredStoredRanges();
          if (localRanges) {
            setMountainRanges(normalizeMountainRanges(localRanges));
            hasHydratedCloudRanges.current = true;
            setCloudSyncErrorStatus(null);
            setIsCloudBootstrapping(false);
            return;
          }

          if (mountainRanges.length > 0) {
            hasHydratedCloudRanges.current = true;
            setCloudSyncErrorStatus(null);
            setIsCloudBootstrapping(false);
            return;
          }

          hasHydratedCloudRanges.current = true;
          setCloudSyncErrorStatus(null);
          setIsCloudBootstrapping(false);
          setCurrentScreen('CLOUD_SYNC_ERROR');
        }
      }
    };

    void hydrateFromCloud();

    return () => {
      isCancelled = true;
      window.clearTimeout(bootstrapWatchdog);
    };
  }, [cloudSyncEnabled, isAuthBootstrapping, user, cloudBootstrapRetryKey, mountainRanges.length]);

  const isAdminUser = user?.role === 'ADMIN';
  const currentUserKeys = buildUserIdentityKeys(user, participantNameMap);
  const isCompletionOwnedByCurrentUser = (completion?: PeakCompletion | null) => {
    if (!completion) {
      return false;
    }

    // Prefer explicit owner when available (new completions).
    if (completion.ownerUserId && user?.id) {
      return completion.ownerUserId === user.id;
    }

    if (!Array.isArray(completion.participants) || completion.participants.length === 0) {
      return false;
    }

    if (currentUserKeys.length === 0) {
      return false;
    }

    return completion.participants.some(participant =>
      currentUserKeys.includes(normalizeText(participant)),
    );
  };
  const canViewCompletion = (completion?: PeakCompletion | null) =>
    Boolean(completion && doesCompletionBelongToUser(completion, user, currentUserKeys));

  const handleLogin = async (userData: User, options?: { requiresPasswordChange?: boolean }) => {
    let resolvedUser = userData;

    if (cloudSyncEnabled && userData.email) {
      const syncedUser = await upsertCloudUser({
        authUserId: userData.id,
        email: userData.email,
        username: userData.username,
        displayName: userData.name,
        avatarUrl: resolveCloudAvatarForPersistence(userData.avatar, userData.username),
      });

      if (syncedUser) {
        resolvedUser = mergeUserWithCloudDirectory(userData, syncedUser);
      }
    }

    setUser(resolvedUser);
    setIsPasswordChangeRequired(Boolean(options?.requiresPasswordChange));
    setCurrentScreen(options?.requiresPasswordChange ? 'LOGIN' : 'HOME');
  };

  const handleLogout = () => {
    if (cloudSyncEnabled) {
      void signOutSupabaseAuth();
    }
    setUser(null);
    setIsPasswordChangeRequired(false);
    setCurrentScreen('LOGIN');
  };

  const handlePasswordUpdated = () => {
    setIsPasswordChangeRequired(false);
    setCurrentScreen('HOME');
  };

  const handleRetryCloudBootstrap = () => {
    hasAttemptedCloudHydration.current = false;
    hasHydratedCloudRanges.current = false;
    setCloudSyncErrorStatus(null);
    setCurrentScreen('HOME');
    setCloudBootstrapRetryKey(prev => prev + 1);
  };

  const handleContinueOffline = () => {
    setCurrentScreen('HOME');
  };

  const scheduleCompletionSyncStatusReset = (delayMs = 4000) => {
    if (typeof window === 'undefined') {
      return;
    }

    if (completionSyncStatusTimeoutRef.current !== null) {
      window.clearTimeout(completionSyncStatusTimeoutRef.current);
    }

    completionSyncStatusTimeoutRef.current = window.setTimeout(() => {
      setCompletionSyncStatus({ state: 'idle', message: '' });
      completionSyncStatusTimeoutRef.current = null;
    }, delayMs);
  };

  const handleProfileUpdate = async (updates: { username: string; avatar: string }) => {
    if (!user) {
      return { ok: false, message: 'Usuário não encontrado.' };
    }

    const sanitizedNextUsername = sanitizeUsername(updates.username);
    const trimmedAvatar = updates.avatar.trim();
    const nextUser: User = {
      ...user,
      username: sanitizedNextUsername || user.username,
      avatar: trimmedAvatar || user.avatar,
    };

    let resolvedUser = nextUser;
    setUser(nextUser);

    if (cloudSyncEnabled) {
      const authProfileResult = await updateSupabaseAuthProfile({
        username: nextUser.username,
        displayName: nextUser.name,
        avatarUrl: nextUser.avatar,
      });

      if ('message' in authProfileResult) {
        return { ok: false, message: authProfileResult.message };
      }

      resolvedUser = {
        ...nextUser,
        name: authProfileResult.profile.displayName,
        username: authProfileResult.profile.username,
        avatar: nextUser.avatar,
        role: authProfileResult.profile.role,
      };
      setUser(resolvedUser);
    }

    if (cloudSyncEnabled && resolvedUser.email) {
      const syncedUser = await upsertCloudUser({
        authUserId: resolvedUser.id,
        email: resolvedUser.email,
        username: resolvedUser.username,
        displayName: resolvedUser.name,
        avatarUrl: resolveCloudAvatarForPersistence(resolvedUser.avatar, resolvedUser.username),
      });

      if (!syncedUser) {
        return { ok: false, message: 'Não foi possível sincronizar a foto de perfil na nuvem.' };
      }

      resolvedUser = mergeUserWithCloudDirectory(resolvedUser, syncedUser);
      setUser(currentUser => (
        currentUser && currentUser.id === resolvedUser.id
          ? resolvedUser
          : currentUser
      ));
      setRegisteredUsers(currentRows => {
        const nextRows = mergeParticipantDirectoryUser(currentRows, {
          username: syncedUser.username,
          display_name: syncedUser.display_name,
          role: syncedUser.role,
          avatar_url: syncedUser.avatar_url,
          created_at: syncedUser.created_at,
        });
        persistParticipantDirectory(nextRows);
        return nextRows;
      });
    }

    return { ok: true };
  };

  const togglePeak = (rangeId: string, peakId: string, completionId?: string) => {
    if (!user) {
      return;
    }

    const range = mountainRanges.find(r => r.id === rangeId);
    const peak = range?.peaks.find(p => p.id === peakId);

    if (peak) {
      const completion = completionId ? peak.completions.find(c => c.id === completionId) : null;
      if (completionId && !canViewCompletion(completion)) {
        return;
      }
      setIsCompletingPeak({ 
        rangeId, 
        peak, 
        completionId,
        isReadOnly: Boolean(completionId && !isAdminUser && !isCompletionOwnedByCurrentUser(completion)),
        initialData: completion ? {
          date: completion.date,
          participants: completion.participants,
          wikilocUrl: completion.wikilocUrl
        } : undefined
      });
    }
  };

  const startPeakEdition = (rangeId: string, peakId: string) => {
    const range = mountainRanges.find(currentRange => currentRange.id === rangeId);
    const peak = range?.peaks.find(currentPeak => currentPeak.id === peakId);
    if (!peak) {
      return;
    }

    setIsEditingPeak({
      rangeId,
      peak,
    });
  };

  const deleteCompletion = (rangeId: string, peakId: string, completionId: string) => {
    const targetCompletion = mountainRanges
      .find(range => range.id === rangeId)
      ?.peaks.find(peak => peak.id === peakId)
      ?.completions.find(completion => completion.id === completionId);

    if (!targetCompletion) {
      return;
    }

    if (!isAdminUser && !isCompletionOwnedByCurrentUser(targetCompletion)) {
      return;
    }

    if (cloudSyncEnabled) {
      void (async () => {
        const wasDeleted = await deleteCloudCompletion(completionId);
        if (!wasDeleted) {
          return;
        }

        setMountainRanges(prev => withRangeStats(prev.map(range => {
          if (range.id !== rangeId) return range;
          const newPeaks = range.peaks.map(peak => {
            if (peak.id !== peakId) return peak;
            return {
              ...peak,
              completions: peak.completions.filter(c => c.id !== completionId)
            };
          });
          return {
            ...range,
            peaks: newPeaks
          };
        })));
      })();
      return;
    }

    setMountainRanges(prev => withRangeStats(prev.map(range => {
      if (range.id !== rangeId) return range;
      const newPeaks = range.peaks.map(peak => {
        if (peak.id !== peakId) return peak;
        return {
          ...peak,
          completions: peak.completions.filter(c => c.id !== completionId)
        };
      });
      return {
        ...range,
        peaks: newPeaks
      };
    })));
  };

  const savePeakCompletion = (rangeId: string, peakId: string, data: { date: string, participants: string[], wikilocUrl?: string }, completionId?: string) => {
    if (!user) {
      return;
    }

    if (cloudSyncEnabled && isSavingCompletion) {
      return;
    }

    const currentUserDisplayName = resolveParticipantDisplayName(user.name, participantNameMap) || user.name;
    const participantsToPersist = [currentUserDisplayName];
    const targetPeak = mountainRanges
      .find(range => range.id === rangeId)
      ?.peaks.find(peak => peak.id === peakId);
    const isCloudOwnedByCurrentUser = (completion: PeakCompletion) =>
      Boolean(user?.id && completion.ownerUserId && completion.ownerUserId === user.id);

    const duplicateSameDayCompletion = targetPeak?.completions.find(completion =>
      completion.date === data.date &&
      completion.id !== completionId &&
      (cloudSyncEnabled ? isCloudOwnedByCurrentUser(completion) : isCompletionOwnedByCurrentUser(completion))
    );

    if (duplicateSameDayCompletion) {
      window.alert('Voce ja tem um check-in neste local nessa data. Edite o check-in existente ou escolha outra data.');
      return;
    }

    const selectedCompletion = completionId
      ? targetPeak?.completions.find(completion => completion.id === completionId)
      : null;
    const editableCompletionId = cloudSyncEnabled
      ? (selectedCompletion && isCloudOwnedByCurrentUser(selectedCompletion) ? selectedCompletion.id : undefined)
      : completionId;

    const existingSameDayCompletionId = editableCompletionId ?? mountainRanges
      .find(range => range.id === rangeId)
      ?.peaks.find(peak => peak.id === peakId)
      ?.completions.find(completion =>
        completion.date === data.date &&
        (cloudSyncEnabled ? isCloudOwnedByCurrentUser(completion) : isCompletionOwnedByCurrentUser(completion))
      )?.id;

    if (cloudSyncEnabled) {
      void (async () => {
        setIsSavingCompletion(true);
        setCompletionSyncStatus({
          state: 'saving',
          message: 'Sincronizando check-in na nuvem... não feche a página.',
        });
        try {
          const savedCompletion = await upsertCloudCompletion({
            peakId,
            completionId: existingSameDayCompletionId,
            date: data.date,
            participants: participantsToPersist,
            wikilocUrl: data.wikilocUrl,
          });

          if (!savedCompletion.ok) {
            const message = 'message' in savedCompletion ? savedCompletion.message : 'Não foi possível salvar a conquista.';
            setCompletionSyncStatus({
              state: 'error',
              message,
            });
            scheduleCompletionSyncStatusReset(6000);
            window.alert(message);
            return;
          }

          const completion = savedCompletion.completion;

          setMountainRanges(prev => withRangeStats(prev.map(range => {
            if (range.id !== rangeId) return range;

            const newPeaks = range.peaks.map(peak => {
              if (peak.id !== peakId) return peak;

              if (existingSameDayCompletionId) {
                return {
                  ...peak,
                  completions: peak.completions.map(c =>
                    c.id === existingSameDayCompletionId
                      ? {
                          ...c,
                          id: completion.id,
                          date: completion.date,
                          participants: completion.participants,
                          wikilocUrl: completion.wikilocUrl,
                          ownerUserId: completion.ownerUserId ?? user.id,
                        }
                      : c
                  ),
                };
              }

              return {
                ...peak,
                completions: [
                  ...peak.completions,
                  {
                    id: completion.id,
                    date: completion.date,
                    participants: completion.participants,
                    ownerUserId: completion.ownerUserId ?? user.id,
                    wikilocUrl: completion.wikilocUrl,
                  },
                ],
              };
            });

            return {
              ...range,
              peaks: newPeaks
            };
          })));
          setIsCompletingPeak(null);
          setCompletionSyncStatus({
            state: 'success',
            message: 'Check-in sincronizado com sucesso.',
          });
          scheduleCompletionSyncStatusReset(3200);
        } finally {
          setIsSavingCompletion(false);
        }
      })();
      return;
    }

    setMountainRanges(prev => withRangeStats(prev.map(range => {
      if (range.id !== rangeId) return range;
      
      const newPeaks = range.peaks.map(peak => {
        if (peak.id !== peakId) return peak;
        
        if (existingSameDayCompletionId) {
          // Update existing completion
          const existing = peak.completions.find(c => c.id === existingSameDayCompletionId);
          return {
            ...peak,
            completions: peak.completions.map(c => 
              c.id === existingSameDayCompletionId 
                ? { 
                    ...c, 
                    date: data.date, 
                    participants: participantsToPersist, 
                    wikilocUrl: data.wikilocUrl,
                    ownerUserId: existing?.ownerUserId ?? user.id,
                  }
                : c
            )
          };
        } else {
          // Add new completion
          const newCompletion: PeakCompletion = {
            id: Math.random().toString(36).substr(2, 9),
            date: data.date,
            participants: participantsToPersist,
            ownerUserId: user.id,
            wikilocUrl: data.wikilocUrl
          };
          return { 
            ...peak, 
            completions: [...peak.completions, newCompletion]
          };
        }
      });

      return {
        ...range,
        peaks: newPeaks
      };
    })));
    setIsCompletingPeak(null);
  };

  const deleteMountainRange = (rangeId: string) => {
    if (!isAdminUser) {
      return;
    }

    setMountainRanges(prev => withRangeStats(prev.filter(range => range.id !== rangeId)));

    if (isAddingPeak?.rangeId === rangeId) {
      setIsAddingPeak(null);
    }
    if (isEditingPeak?.rangeId === rangeId) {
      setIsEditingPeak(null);
    }
    if (isCompletingPeak?.rangeId === rangeId) {
      setIsCompletingPeak(null);
    }
  };

  const deletePeakRegistration = (rangeId: string, peakId: string) => {
    if (!isAdminUser) {
      return;
    }

    setMountainRanges(prev => withRangeStats(prev.map(range => {
      if (range.id !== rangeId) {
        return range;
      }

      return {
        ...range,
        peaks: range.peaks.filter(peak => peak.id !== peakId),
      };
    })));

    if (isEditingPeak?.rangeId === rangeId && isEditingPeak.peak.id === peakId) {
      setIsEditingPeak(null);
    }
    if (isCompletingPeak?.rangeId === rangeId && isCompletingPeak.peak.id === peakId) {
      setIsCompletingPeak(null);
    }
  };

  const addMountainRange = (name: string) => {
    if (!isAdminUser) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    const newRange: MountainRange = {
      id: slugifyText(trimmedName),
      name: trimmedName,
      totalPeaks: 0,
      completedPeaks: 0,
      peaks: []
    };
    setMountainRanges(prev => [...prev, newRange]);
    setIsAddingRange(false);
  };

  const exportBackupToFile = () => {
    if (typeof window === 'undefined') {
      return;
    }

    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      [MOUNTAIN_RANGES_STORAGE_KEY]: mountainRanges,
      [MOUNTAIN_RANGES_BACKUP_STORAGE_KEY]: mountainRanges,
    };
    const backupBlob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const blobUrl = window.URL.createObjectURL(backupBlob);
    const downloadLink = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    downloadLink.href = blobUrl;
    downloadLink.download = `penitencia-backup-${timestamp}.json`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.URL.revokeObjectURL(blobUrl);
  };

  const importBackupFromText = (backupText: string): { success: boolean; message: string } => {
    if (typeof window === 'undefined') {
      return { success: false, message: 'Importação indisponível neste ambiente.' };
    }

    try {
      const parsedBackup = JSON.parse(backupText);
      const importedRanges = parseBackupRanges(parsedBackup);

      if (!importedRanges) {
        return { success: false, message: 'Arquivo inválido: não encontrei dados de serras para restaurar.' };
      }

      const normalizedRanges = normalizeMountainRanges(importedRanges);
      setMountainRanges(normalizedRanges);

      if (cloudSyncEnabled) {
        if (!isAdminUser) {
          return { success: false, message: 'Somente admin pode importar backup na nuvem.' };
        }
        void saveRangesToCloud(normalizedRanges);
        return { success: true, message: 'Backup importado e sincronizado com o banco.' };
      }

      const previousRangesJson = window.localStorage.getItem(MOUNTAIN_RANGES_STORAGE_KEY);
      if (previousRangesJson) {
        window.localStorage.setItem(MOUNTAIN_RANGES_BACKUP_STORAGE_KEY, previousRangesJson);
      }

      const importedRangesJson = JSON.stringify(normalizedRanges);
      window.localStorage.setItem(MOUNTAIN_RANGES_STORAGE_KEY, importedRangesJson);
      window.localStorage.setItem(MOUNTAIN_RANGES_BACKUP_STORAGE_KEY, importedRangesJson);

      return { success: true, message: 'Backup importado com sucesso.' };
    } catch {
      return { success: false, message: 'Não foi possível ler o arquivo. Verifique se é um JSON válido.' };
    }
  };

  const addPeak = (
    rangeId: string,
    name: string,
    localType: LocalType,
    altitude_metros: number | null,
    altura_queda_metros: number | null,
  ) => {
    if (!isAdminUser) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    setMountainRanges(prev => withRangeStats(prev.map(range => {
      if (range.id !== rangeId) return range;

      const alreadyExists = range.peaks.some(
        peak =>
          normalizeText(peak.name) === normalizeText(trimmedName) &&
          resolvePeakLocalType(peak) === localType,
      );
      if (alreadyExists) {
        return range;
      }

      const newPeak: Peak = {
        id: slugifyText(trimmedName),
        name: trimmedName,
        tipo_local: localType,
        altitude_metros,
        altura_queda_metros: localType === 'cachoeira' ? altura_queda_metros : null,
        estado: FIXED_STATE,
        category: localType === 'cachoeira' ? 'WATERFALL' : 'PEAK',
        completions: []
      };

      return {
        ...range,
        peaks: [...range.peaks, newPeak]
      };
    })));
    setIsAddingPeak(null);
  };

  const savePeakRegistration = (data: {
    name: string,
    rangeId: string,
    localType: LocalType,
    altitude_metros: number | null,
    altura_queda_metros: number | null,
  }) => {
    if (!isAdminUser) {
      return;
    }

    if (!isEditingPeak) {
      return;
    }

    const trimmedName = data.name.trim();
    if (!trimmedName) {
      return;
    }

    setMountainRanges(prev => {
      const rangesWithoutSourcePeak = cloneRanges(prev);
      let movingPeak: Peak | null = null;

      const sourceRangeIndex = rangesWithoutSourcePeak.findIndex(
        range => range.id === isEditingPeak.rangeId,
      );
      if (sourceRangeIndex < 0) {
        return prev;
      }

      const sourceRange = rangesWithoutSourcePeak[sourceRangeIndex];
      const sourcePeakIndex = sourceRange.peaks.findIndex(peak => peak.id === isEditingPeak.peak.id);
      if (sourcePeakIndex < 0) {
        return prev;
      }

      movingPeak = sourceRange.peaks[sourcePeakIndex];
      sourceRange.peaks.splice(sourcePeakIndex, 1);
      rangesWithoutSourcePeak[sourceRangeIndex] = sourceRange;

      const editedPeak: Peak = {
        ...movingPeak,
        id: slugifyText(trimmedName) || movingPeak.id,
        name: trimmedName,
        tipo_local: data.localType,
        altitude_metros: data.altitude_metros,
        altura_queda_metros: data.localType === 'cachoeira' ? data.altura_queda_metros : null,
        estado: FIXED_STATE,
        category: data.localType === 'cachoeira' ? 'WATERFALL' : 'PEAK',
        completions: [...movingPeak.completions],
      };

      const targetRangeIndex = rangesWithoutSourcePeak.findIndex(
        range => range.id === data.rangeId,
      );
      if (targetRangeIndex < 0) {
        return prev;
      }

      const targetRange = rangesWithoutSourcePeak[targetRangeIndex];
      const existingPeakIndex = targetRange.peaks.findIndex(
        peak =>
          normalizeText(peak.name) === normalizeText(trimmedName) &&
          resolvePeakLocalType(peak) === data.localType,
      );

      if (existingPeakIndex >= 0) {
        const existingPeak = targetRange.peaks[existingPeakIndex];
        targetRange.peaks[existingPeakIndex] = {
          ...existingPeak,
          id: existingPeak.id || editedPeak.id,
          name: trimmedName,
          tipo_local: data.localType,
          altitude_metros: editedPeak.altitude_metros ?? resolvePeakAltitude(existingPeak),
          altura_queda_metros: data.localType === 'cachoeira'
            ? (editedPeak.altura_queda_metros ?? resolvePeakDropHeight(existingPeak))
            : null,
          estado: FIXED_STATE,
          category: data.localType === 'cachoeira' ? 'WATERFALL' : 'PEAK',
          completions: mergePeakCompletions(existingPeak.completions, editedPeak.completions),
        };
      } else {
        targetRange.peaks.push(editedPeak);
      }

      rangesWithoutSourcePeak[targetRangeIndex] = targetRange;
      return withRangeStats(rangesWithoutSourcePeak);
    });

    setIsEditingPeak(null);
  };

  const participantSuggestions: string[] = Array.from(
    new Set<string>(
      [
        ...registeredUsers
          .filter(registeredUser => registeredUser.role !== 'ADMIN')
          .map(registeredUser => registeredUser.display_name),
        ...mountainRanges.flatMap(range =>
          range.peaks.flatMap(peak =>
            peak.completions.flatMap(completion =>
              completion.participants.map(participant =>
                resolveParticipantDisplayName(participant, participantNameMap),
              ),
            ),
          ),
        ),
      ],
    ),
  )
    .filter(name => participantNameMap.has(normalizeText(name)))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const pendingCompletionSyncCount = isSavingCompletion ? 1 : 0;

  if (isAuthBootstrapping) {
    return (
      <div className="min-h-screen bg-background-dark flex flex-col items-center justify-center p-8 text-center">
        <div className="size-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-5" />
        <p className="text-primary font-bold text-lg">Validando sessão...</p>
        <p className="text-slate-400 text-sm mt-2">Conectando com Supabase Auth.</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} isCloudEnabled={cloudSyncEnabled} />;
  }

  if (isPasswordChangeRequired) {
    return (
      <PasswordUpdateScreen
        user={user}
        onPasswordUpdated={handlePasswordUpdated}
        onLogout={handleLogout}
      />
    );
  }

  if (currentScreen === 'MAINTENANCE') {
    return (
      <MaintenanceScreen
        onRetry={handleRetryCloudBootstrap}
        onContinueOffline={handleContinueOffline}
        isRetrying={isCloudBootstrapping}
      />
    );
  }

  if (currentScreen === 'CLOUD_SYNC_ERROR') {
    return (
      <CloudSyncErrorScreen
        onRetry={handleRetryCloudBootstrap}
        onContinueOffline={handleContinueOffline}
        isRetrying={isCloudBootstrapping}
        statusCode={cloudSyncErrorStatus}
      />
    );
  }

  const renderScreen = () => {
    switch (currentScreen) {
      case 'HOME':
        return (
          <HomeScreen
            user={user}
            mountainRanges={mountainRanges}
            participantNameMap={participantNameMap}
            onViewAllSerras={() => setCurrentScreen('SERRAS')}
            onOpenProfile={() => setCurrentScreen('PERFIL')}
          />
        );
      case 'SERRAS':
        return (
          <SerrasScreen 
            user={user}
            participantNameMap={participantNameMap}
            mountainRanges={mountainRanges} 
            onTogglePeak={togglePeak} 
            onDeleteCompletion={deleteCompletion}
            onAddPeak={(rangeId) => setIsAddingPeak({ rangeId })}
            onEditPeak={startPeakEdition}
            onAddRange={() => setIsAddingRange(true)}
            onDeletePeak={deletePeakRegistration}
            onDeleteRange={deleteMountainRange}
            canManageCatalog={isAdminUser}
            canDeleteCompletion={(completion) => isAdminUser || isCompletionOwnedByCurrentUser(completion)}
            canViewCompletion={(completion) => isAdminUser || canViewCompletion(completion)}
            onBack={() => setCurrentScreen('HOME')}
          />
        );
      case 'RANKING':
        return (
          <RankingScreen
            user={user}
            mountainRanges={mountainRanges}
            participantNameMap={participantNameMap}
            participantAvatarMap={participantAvatarMap}
            adminIdentityKeys={adminIdentityKeys}
            onOpenProfile={() => setCurrentScreen('PERFIL')}
            onBack={() => setCurrentScreen('HOME')}
          />
        );
      case 'PERFIL':
        return (
          <PerfilScreen
            user={user}
            mountainRanges={mountainRanges}
            isCloudEnabled={cloudSyncEnabled}
            participantNameMap={participantNameMap}
            onUpdateProfile={handleProfileUpdate}
            onExportBackup={exportBackupToFile}
            onImportBackup={importBackupFromText}
            onLogout={handleLogout}
          />
        );
      default:
        return (
          <HomeScreen
            user={user}
            mountainRanges={mountainRanges}
            participantNameMap={participantNameMap}
            onViewAllSerras={() => setCurrentScreen('SERRAS')}
            onOpenProfile={() => setCurrentScreen('PERFIL')}
          />
        );
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background-dark text-slate-100 font-sans w-full relative overflow-x-clip">
      {/* Main Content */}
      <main className="mx-auto w-full max-w-5xl px-0 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentScreen}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {renderScreen()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isAddingRange && (
          <CreateModal 
            title="Nova Região" 
            placeholder="Nome da região/grupo (ex: Ilha do Mel)"
            onClose={() => setIsAddingRange(false)} 
            onSave={addMountainRange} 
          />
        )}
        {isAddingPeak && (
          <PeakFormModal
            title="Novo Local" 
            submitLabel="Salvar"
            mountainRanges={mountainRanges}
            initialRangeId={isAddingPeak.rangeId}
            onClose={() => setIsAddingPeak(null)} 
            onSave={({ name, rangeId, localType, altitude_metros, altura_queda_metros }) =>
              addPeak(rangeId, name, localType, altitude_metros, altura_queda_metros)
            }
          />
        )}
        {isEditingPeak && (
          <PeakFormModal
            title="Editar Local"
            submitLabel="Atualizar"
            mountainRanges={mountainRanges}
            initialName={isEditingPeak.peak.name}
            initialRangeId={isEditingPeak.rangeId}
            initialLocalType={resolvePeakLocalType(isEditingPeak.peak)}
            initialAltitudeMetros={resolvePeakAltitude(isEditingPeak.peak)}
            initialDropHeightMetros={resolvePeakDropHeight(isEditingPeak.peak)}
            onClose={() => setIsEditingPeak(null)}
            onSave={savePeakRegistration}
          />
        )}
        {isCompletingPeak && (
          <CompletionModal
            peak={isCompletingPeak.peak}
            initialData={isCompletingPeak.initialData}
            isReadOnly={isCompletingPeak.isReadOnly}
            isSaving={isSavingCompletion}
            participantSuggestions={participantSuggestions}
            participantNameMap={participantNameMap}
            isLoadingParticipantSuggestions={isLoadingRegisteredUsers}
            currentUser={user}
            isAdmin={isAdminUser}
            onClose={() => setIsCompletingPeak(null)}
            onSave={(data) => savePeakCompletion(isCompletingPeak.rangeId, isCompletingPeak.peak.id, data, isCompletingPeak.completionId)}
          />
        )}
      </AnimatePresence>

      {cloudSyncEnabled && completionSyncStatus.state !== 'idle' && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.9rem+env(safe-area-inset-bottom))] z-40 px-3 sm:px-6">
          <div
            className={`mx-auto flex w-full max-w-5xl items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs font-bold shadow-xl backdrop-blur-xl ${
              completionSyncStatus.state === 'error'
                ? 'border-red-400/30 bg-red-500/15 text-red-100'
                : completionSyncStatus.state === 'success'
                  ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100'
                  : 'border-sky-400/30 bg-sky-500/15 text-sky-100'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              {completionSyncStatus.state === 'saving' && <RefreshCw size={14} className="animate-spin" />}
              {completionSyncStatus.state === 'success' && <CheckCircle2 size={14} />}
              {completionSyncStatus.state === 'error' && <AlertTriangle size={14} />}
              {completionSyncStatus.message}
            </span>
            {completionSyncStatus.state === 'saving' && (
              <span className="rounded-full border border-current/40 px-2 py-0.5 text-[10px] uppercase tracking-wider">
                Pendente: {pendingCompletionSyncCount}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Floating Action Button */}
      {currentScreen === 'SERRAS' && isAdminUser && (
        <button 
          onClick={() => setIsAddingRange(true)}
          className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-50 size-14 bg-primary text-background-dark rounded-full flex items-center justify-center shadow-lg shadow-primary/20 hover:scale-105 transition-transform active:scale-95 sm:right-6"
        >
          <Plus size={32} strokeWidth={3} />
        </button>
      )}

      {/* Bottom Navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40">
        <div className="mx-auto w-full max-w-5xl px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-6">
          <div className="flex items-center justify-between rounded-[1.75rem] border border-white/8 bg-black/80 px-4 py-2 shadow-2xl backdrop-blur-xl sm:px-6">
            <NavButton 
              active={currentScreen === 'HOME'} 
              onClick={() => setCurrentScreen('HOME')} 
              icon={<HomeIcon size={24} />} 
              label="HOME" 
            />
            <NavButton 
              active={currentScreen === 'SERRAS'} 
              onClick={() => setCurrentScreen('SERRAS')} 
              icon={<Mountain size={24} />} 
              label="REGIÕES" 
            />
            <NavButton 
              active={currentScreen === 'RANKING'} 
              onClick={() => setCurrentScreen('RANKING')} 
              icon={<Trophy size={24} />} 
              label="RANKING" 
            />
            <NavButton 
              active={currentScreen === 'PERFIL'} 
              onClick={() => setCurrentScreen('PERFIL')} 
              icon={<UserIcon size={24} />} 
              label="PERFIL" 
            />
          </div>
        </div>
      </nav>
    </div>
  );
}

function MaintenanceScreen({
  onRetry,
  onContinueOffline,
  isRetrying,
}: {
  onRetry: () => void;
  onContinueOffline: () => void;
  isRetrying?: boolean;
}) {
  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center overflow-x-hidden px-5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8">
      <div className="absolute left-1/2 top-1/4 -z-10 size-72 -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />

      <div className="space-y-8 rounded-[2rem] border border-primary/15 bg-black/40 p-6 text-center shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
        <div className="mx-auto flex size-20 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10">
          <Wrench size={36} className="text-primary" />
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary">Manutenção</p>
          <h1 className="text-3xl font-black tracking-tight text-slate-50">Voltamos em instantes</h1>
          <p className="text-sm leading-relaxed text-slate-400">
            A sincronização na nuvem está temporariamente indisponível. Você pode tentar novamente agora
            ou seguir usando os dados locais enquanto estabilizamos o serviço.
          </p>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-bold text-background-dark shadow-lg shadow-primary/20 transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-60"
          >
            <RefreshCw size={18} className={isRetrying ? 'animate-spin' : ''} />
            {isRetrying ? 'Tentando novamente...' : 'Tentar novamente'}
          </button>
          <button
            type="button"
            onClick={onContinueOffline}
            className="flex h-12 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-bold text-slate-200 transition-colors hover:bg-white/10"
          >
            Continuar com dados locais
          </button>
        </div>
      </div>
    </div>
  );
}

function CloudSyncErrorScreen({
  onRetry,
  onContinueOffline,
  isRetrying,
  statusCode,
}: {
  onRetry: () => void;
  onContinueOffline: () => void;
  isRetrying?: boolean;
  statusCode?: number | null;
}) {
  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center overflow-x-hidden px-5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8">
      <div className="absolute left-1/2 top-1/4 -z-10 size-72 -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />

      <div className="space-y-8 rounded-[2rem] border border-primary/15 bg-black/40 p-6 text-center shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
        <div className="mx-auto flex size-20 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10">
          <CloudOff size={36} className="text-primary" />
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary">Sync</p>
          <h1 className="text-3xl font-black tracking-tight text-slate-50">Falha ao sincronizar</h1>
          <p className="text-sm leading-relaxed text-slate-400">
            Não conseguimos carregar os dados da nuvem neste momento. Você pode tentar novamente ou
            continuar com a versão local disponível neste aparelho.
          </p>
          {typeof statusCode === 'number' && (
            <p className="inline-flex items-center justify-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-200">
              <AlertTriangle size={14} />
              HTTP {statusCode}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-bold text-background-dark shadow-lg shadow-primary/20 transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-60"
          >
            <RefreshCw size={18} className={isRetrying ? 'animate-spin' : ''} />
            {isRetrying ? 'Tentando novamente...' : 'Tentar novamente'}
          </button>
          <button
            type="button"
            onClick={onContinueOffline}
            className="flex h-12 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-bold text-slate-200 transition-colors hover:bg-white/10"
          >
            Continuar com dados locais
          </button>
        </div>
      </div>
    </div>
  );
}

function CompletionModal({
  peak,
  initialData,
  isReadOnly = false,
  isSaving = false,
  participantSuggestions,
  participantNameMap,
  isLoadingParticipantSuggestions,
  currentUser,
  isAdmin,
  onClose,
  onSave,
}: { 
  peak: Peak, 
  initialData?: { date: string, participants: string[], wikilocUrl?: string },
  isReadOnly?: boolean,
  isSaving?: boolean,
  participantSuggestions: string[],
  participantNameMap: Map<string, string>,
  isLoadingParticipantSuggestions: boolean,
  currentUser: User,
  isAdmin: boolean,
  onClose: () => void, 
  onSave: (data: { date: string, participants: string[], wikilocUrl?: string }) => void 
}) {
  const parseBRDateToISO = (brDate: string) => {
    const [day, month, year] = brDate.split('/');
    return `${year}-${month}-${day}`;
  };

  const formatISOToBRDate = (isoDate: string) => {
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
  };

  const getTodayLocalISODate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [date, setDate] = useState(initialData ? parseBRDateToISO(initialData.date) : getTodayLocalISODate());
  const currentUserDisplayName = resolveParticipantDisplayName(currentUser.name, participantNameMap) || currentUser.name;
  const participants = isReadOnly
    ? sanitizeParticipants(initialData?.participants ?? [], participantNameMap)
    : [currentUserDisplayName];
  const formDisabled = isReadOnly || isSaving;
  const [wikilocUrl, setWikilocUrl] = useState(initialData?.wikilocUrl || '');

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm overflow-x-hidden overscroll-none sm:p-6"
    >
      <motion.div 
        initial={{ scale: 0.98, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.98, opacity: 0, y: 20 }}
        className="relative mx-auto w-full max-w-sm rounded-3xl border border-primary/20 bg-neutral-forest p-4 sm:p-6 space-y-5 sm:space-y-6 max-h-[min(88dvh,42rem)] overflow-y-auto overflow-x-hidden overscroll-contain no-scrollbar"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold">
            {isReadOnly ? 'Detalhes de' : initialData ? 'Editar' : 'Concluir'} {peak.name}
          </h2>
          <button onClick={onClose} disabled={isSaving} className="text-slate-500 hover:text-white disabled:opacity-40">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Date */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
              <Calendar size={12} /> Data da Conquista
            </label>
            <div className="relative">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={formDisabled}
                className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-12 px-4 text-base sm:text-sm focus:outline-none focus:border-primary transition-all text-white"
              />
            </div>
          </div>

          {/* Participant */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
              <UserIcon size={12} /> {isReadOnly ? 'Participantes' : 'Check-in individual'}
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {participants.map(p => (
                <span key={p} className="bg-primary/10 text-primary text-[10px] font-bold px-3 py-1.5 rounded-full border border-primary/20 flex items-center gap-1.5">
                  {p}
                </span>
              ))}
            </div>
          </div>

          {/* Wikiloc URL */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
              <MapIcon size={12} /> URL Wikiloc (Opcional)
            </label>
            <input 
              type="url" 
              placeholder="https://pt.wikiloc.com/..."
              value={wikilocUrl}
              onChange={(e) => setWikilocUrl(e.target.value)}
              disabled={formDisabled}
              className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-12 px-4 text-base sm:text-sm focus:outline-none focus:border-primary transition-all"
            />
            {isReadOnly && wikilocUrl && (
              <a
                href={wikilocUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
              >
                <MapIcon size={12} /> Abrir no Wikiloc
              </a>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button 
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 h-12 rounded-2xl border border-white/10 text-slate-400 font-bold text-base sm:text-sm"
          >
            {isReadOnly ? 'Fechar' : isSaving ? 'Salvando...' : 'Cancelar'}
          </button>
          {!isReadOnly && (
            <button 
              disabled={isSaving}
              onClick={() => onSave({
                date: formatISOToBRDate(date),
                participants,
                wikilocUrl,
              })}
              className="flex-1 h-12 rounded-2xl bg-primary text-background-dark font-bold text-base sm:text-sm disabled:opacity-60"
            >
              {isSaving ? 'Salvando...' : initialData ? 'Salvar' : 'Confirmar'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function LoginScreen({
  onLogin,
  isCloudEnabled,
}: {
  onLogin: (user: User, options?: { requiresPasswordChange?: boolean }) => void | Promise<void>;
  isCloudEnabled: boolean;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (!isCloudEnabled) {
        setError('Configure o Supabase no .env.local para usar autenticação.');
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || !password.trim()) {
        setError('Preencha e-mail e senha.');
        return;
      }

      const authResult = mode === 'signin'
        ? await signInWithSupabaseAuth({
            email: normalizedEmail,
            password,
          })
        : await signUpWithSupabaseAuth({
            email: normalizedEmail,
            password,
            displayName: displayName.trim() || undefined,
          });

      if ('message' in authResult) {
        setError(authResult.message);
        return;
      }

      await onLogin(toAppUserFromAuthProfile(authResult.profile));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center overflow-x-hidden px-5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8">
      {/* Background Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 size-64 bg-primary/10 blur-[100px] rounded-full -z-10" />
      
      <div className="space-y-8 sm:space-y-12">
        <header className="space-y-4 text-center">
          <div className="inline-flex items-center justify-center size-20 bg-primary/10 rounded-3xl border border-primary/20 mb-4">
            <Mountain size={40} className="text-primary" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Penitência CWB</h1>
          <p className="text-slate-400 text-sm">
            {mode === 'signin'
              ? 'Entre com seu e-mail para continuar sua jornada.'
              : 'Crie sua conta com e-mail e senha para começar.'}
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
          <div className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/60" size={20} />
              <input 
                type="email"
                autoComplete="email"
                placeholder="seuemail@dominio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-14 pl-12 pr-4 text-sm focus:outline-none focus:border-primary transition-all placeholder:text-slate-600"
                required
              />
            </div>
            {mode === 'signup' && (
              <div className="relative">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/60" size={20} />
                <input
                  type="text"
                  autoComplete="name"
                  placeholder="Nome para exibição (opcional)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-14 pl-12 pr-4 text-sm focus:outline-none focus:border-primary transition-all placeholder:text-slate-600"
                />
              </div>
            )}
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/60" size={20} />
              <input 
                type={showPassword ? 'text' : 'password'} 
                placeholder={mode === 'signin' ? 'Sua senha' : 'Crie uma senha'}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-14 pl-12 pr-12 text-sm focus:outline-none focus:border-primary transition-all placeholder:text-slate-600"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/60 hover:text-primary transition-colors p-1"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-xs font-bold text-center">{error}</p>
          )}

          <button 
            type="submit"
            disabled={isLoading}
            className="w-full bg-primary text-background-dark font-bold h-14 rounded-2xl shadow-lg shadow-primary/20 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
          >
            {isLoading ? (
              <div className="size-5 border-2 border-background-dark border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                {mode === 'signin' ? 'Entrar na Expedição' : 'Criar Conta'}
                <ArrowRight size={20} />
              </>
            )}
          </button>

        </form>

        <footer className="text-center">
          <button
            type="button"
            onClick={() => {
              setError('');
              setMode(prev => (prev === 'signin' ? 'signup' : 'signin'));
            }}
            className="text-primary/60 text-xs font-bold uppercase tracking-widest hover:text-primary transition-colors"
          >
            {mode === 'signin' ? 'Não tem conta? Criar agora' : 'Já tem conta? Entrar'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function PasswordUpdateScreen({
  user,
  onPasswordUpdated,
  onLogout,
}: {
  user: User;
  onPasswordUpdated: () => void;
  onLogout: () => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!newPassword || !confirmPassword) {
      setError('Preencha a nova senha e a confirmação.');
      return;
    }

    if (newPassword.length < 6) {
      setError('Use no mínimo 6 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('As senhas não conferem.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await updateSupabaseAuthPassword(newPassword);
      if ('message' in result) {
        setError(result.message);
        return;
      }

      onPasswordUpdated();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center overflow-x-hidden px-5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 size-64 bg-primary/10 blur-[100px] rounded-full -z-10" />

      <div className="space-y-8 sm:space-y-10">
        <header className="space-y-3 text-center">
          <div className="inline-flex items-center justify-center size-20 bg-primary/10 rounded-3xl border border-primary/20 mb-2">
            <Lock size={36} className="text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Trocar Senha</h1>
          <p className="text-slate-400 text-sm">
            Primeiro acesso de <span className="text-slate-200 font-semibold">{user.email ?? user.username}</span>.
          </p>
          <p className="text-slate-500 text-xs">
            Por segurança, defina uma senha nova para continuar.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/60" size={20} />
              <input
                type={showNewPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Nova senha"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-14 pl-12 pr-12 text-sm focus:outline-none focus:border-primary transition-all placeholder:text-slate-600"
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/60 hover:text-primary transition-colors p-1"
                aria-label={showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
                title={showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/60" size={20} />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Confirmar nova senha"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-14 pl-12 pr-12 text-sm focus:outline-none focus:border-primary transition-all placeholder:text-slate-600"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/60 hover:text-primary transition-colors p-1"
                aria-label={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
                title={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-xs font-bold text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-primary text-background-dark font-bold h-14 rounded-2xl shadow-lg shadow-primary/20 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
          >
            {isLoading ? (
              <div className="size-5 border-2 border-background-dark border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                Atualizar senha
                <ArrowRight size={20} />
              </>
            )}
          </button>
        </form>

        <footer className="text-center">
          <button
            type="button"
            onClick={onLogout}
            className="text-primary/60 text-xs font-bold uppercase tracking-widest hover:text-primary transition-colors"
          >
            Sair
          </button>
        </footer>
      </div>
    </div>
  );
}

function PerfilScreen({
  user,
  mountainRanges,
  isCloudEnabled,
  participantNameMap,
  onUpdateProfile,
  onExportBackup,
  onImportBackup,
  onLogout,
}: {
  user: User,
  mountainRanges: MountainRange[],
  isCloudEnabled: boolean,
  participantNameMap: Map<string, string>,
  onUpdateProfile: (updates: { username: string; avatar: string }) => Promise<{ ok: boolean; message?: string }>,
  onExportBackup: () => void,
  onImportBackup: (backupText: string) => { success: boolean; message: string },
  onLogout: () => void
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [isImportingBackup, setIsImportingBackup] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState<CloudAppUser[]>([]);
  const [isLoadingRegisteredUsers, setIsLoadingRegisteredUsers] = useState(false);
  const [draftUsername, setDraftUsername] = useState(user.username);
  const [draftAvatar, setDraftAvatar] = useState(user.avatar);
  const [profileError, setProfileError] = useState('');
  const [profileSuccessMessage, setProfileSuccessMessage] = useState('');
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccessMessage, setPasswordSuccessMessage] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isPasswordSectionOpen, setIsPasswordSectionOpen] = useState(false);
  const userKeys = buildUserIdentityKeys(user, participantNameMap);
  const isUserParticipant = (participants: string[] | undefined) => {
    if (!Array.isArray(participants) || participants.length === 0) {
      return true;
    }

    if (userKeys.length === 0) {
      return false;
    }

    return participants.some(participant => userKeys.includes(normalizeText(participant)));
  };

  const allLocals = mountainRanges.flatMap(range => (Array.isArray(range.peaks) ? range.peaks : []));
  const isLocalConqueredByUser = (local: Peak) =>
    local.completions.some(completion => isUserParticipant(completion.participants));
  const userConqueredLocals = allLocals.filter(local =>
    isLocalConqueredByUser(local),
  );
  const userStatsByType = LOCAL_TYPES.reduce((acc, localType) => {
    acc[localType] = userConqueredLocals.filter(local => resolvePeakLocalType(local) === localType).length;
    return acc;
  }, {} as Record<LocalType, number>);
  const userRangeProgress = mountainRanges.map(range => {
    const locals = Array.isArray(range.peaks) ? range.peaks : [];
    const explored = locals.some(local => isLocalConqueredByUser(local));
    const targetLocals = locals.filter(local => {
      const localType = resolvePeakLocalType(local);
      return localType === 'pico' || localType === 'morro';
    });
    const conqueredTargets = targetLocals.filter(local => isLocalConqueredByUser(local)).length;
    const conquered = targetLocals.length > 0 && conqueredTargets === targetLocals.length;

    return { explored, conquered };
  });
  const userExploredRangesCount = userRangeProgress.filter(range => range.explored).length;
  const userConqueredRangesCount = userRangeProgress.filter(range => range.conquered).length;
  const highestConqueredPeak = userConqueredLocals
    .filter(local => resolvePeakLocalType(local) === 'pico' && typeof local.altitude_metros === 'number')
    .sort((a, b) => {
      const altitudeDifference = (b.altitude_metros as number) - (a.altitude_metros as number);
      if (altitudeDifference !== 0) {
        return altitudeDifference;
      }
      return a.name.localeCompare(b.name, 'pt-BR');
    })[0] ?? null;
  const handleImportBackupFile: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    setIsImportingBackup(true);
    try {
      const backupText = await selectedFile.text();
      const result = onImportBackup(backupText);
      window.alert(result.message);
    } catch {
      window.alert('Falha ao ler arquivo de backup.');
    } finally {
      event.target.value = '';
      setIsImportingBackup(false);
    }
  };

  useEffect(() => {
    setDraftUsername(user.username);
    setDraftAvatar(user.avatar);
  }, [user.avatar, user.username]);

  const handleAvatarFileChange: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setProfileError('Selecione um arquivo de imagem válido.');
      return;
    }

    try {
      const optimizedAvatar = await buildOptimizedAvatarDataUrl(file);
      setDraftAvatar(optimizedAvatar);
      setProfileError('');
      setProfileSuccessMessage('');
    } catch {
      setProfileError('Não foi possível processar a imagem.');
      setProfileSuccessMessage('');
    }

    event.target.value = '';
  };

  const handleSaveProfile = async () => {
    const sanitized = sanitizeUsername(draftUsername);
    if (!sanitized) {
      setProfileError('Informe um @ válido usando letras, números, ponto, hífen ou underscore.');
      setProfileSuccessMessage('');
      return;
    }

    if (!draftAvatar.trim()) {
      setProfileError('Adicione uma foto ou informe a URL da imagem.');
      setProfileSuccessMessage('');
      return;
    }

    const result = await onUpdateProfile({
      username: sanitized,
      avatar: draftAvatar.trim(),
    });
    if (!result.ok) {
      setProfileError(result.message ?? 'Não foi possível atualizar o perfil.');
      setProfileSuccessMessage('');
      return;
    }

    setDraftUsername(sanitized);
    setProfileError('');
    setProfileSuccessMessage('Perfil atualizado.');
    setIsProfileEditorOpen(false);
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccessMessage('');

    if (!user.email?.trim()) {
      setPasswordError('Não foi possível validar sua sessão. Saia e entre novamente antes de trocar a senha.');
      return;
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('Preencha a senha atual, a nova senha e a confirmação.');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Use no mínimo 6 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não conferem.');
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const signInResult = await signInWithSupabaseAuth({
        email: user.email,
        password: currentPassword,
      });

      if ('message' in signInResult) {
        setPasswordError('Senha atual incorreta. Confira e tente novamente.');
        return;
      }

      const result = await updateSupabaseAuthPassword(newPassword);
      if ('message' in result) {
        setPasswordError(result.message);
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccessMessage('Senha atualizada com sucesso.');
      setIsPasswordSectionOpen(false);
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  useEffect(() => {
    if (!isCloudEnabled || user.role !== 'ADMIN') {
      return;
    }

    let isCancelled = false;
    const loadRegisteredUsers = async () => {
      setIsLoadingRegisteredUsers(true);
      const rows = await listCloudUsers();
      if (!isCancelled && Array.isArray(rows)) {
        setRegisteredUsers(rows);
      }
      if (!isCancelled) {
        setIsLoadingRegisteredUsers(false);
      }
    };

    void loadRegisteredUsers();
    return () => {
      isCancelled = true;
    };
  }, [isCloudEnabled, user.role]);

  return (
    <div className="w-full min-w-0 overflow-x-hidden p-4 pt-6 sm:p-6 sm:pt-8 space-y-8">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Meu Perfil</h1>
      </header>

      <div className="flex min-w-0 flex-col items-center space-y-4">
        <div className="relative">
          <div className="size-32 rounded-full border-4 border-primary p-1">
            <AvatarImage
              src={draftAvatar || user.avatar}
              alt={user.name}
              className="w-full h-full object-cover rounded-full"
            />
          </div>
          <button
            type="button"
            onClick={() => setIsProfileEditorOpen(true)}
            className="absolute bottom-1 right-1 size-10 rounded-full bg-primary text-background-dark flex items-center justify-center border-2 border-background-dark"
            aria-label="Editar foto"
            title="Editar foto"
          >
            <Pencil size={16} />
          </button>
        </div>
        <div className="min-w-0 text-center">
          <h2 className="break-words text-xl font-bold">{user.name}</h2>
          <button
            type="button"
            onClick={() => setIsProfileEditorOpen(true)}
            className="inline-flex max-w-full items-center gap-2 text-slate-400 text-sm hover:text-primary transition-colors"
          >
            <span className="truncate">@{user.username}</span>
            <Pencil size={14} />
          </button>
          <div className="mt-2 inline-flex px-3 py-1 bg-primary/10 text-primary text-[10px] font-bold rounded-full border border-primary/20 uppercase tracking-widest">
            {user.role}
          </div>
        </div>
      </div>

      {isProfileEditorOpen && (
        <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Perfil Publico</h3>
            <button
              type="button"
              onClick={() => {
                setDraftUsername(user.username);
                setDraftAvatar(user.avatar);
                setProfileError('');
                setProfileSuccessMessage('');
                setIsProfileEditorOpen(false);
              }}
              className="text-slate-400 hover:text-white transition-colors"
              aria-label="Fechar edicao de perfil"
              title="Fechar"
            >
              <X size={18} />
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Foto</label>
            <input
              type="url"
              value={draftAvatar}
              onChange={(e) => {
                setDraftAvatar(e.target.value);
                setProfileError('');
                setProfileSuccessMessage('');
              }}
              placeholder="https://..."
              className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-12 px-4 text-sm focus:outline-none focus:border-primary transition-all"
            />
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="w-full h-11 rounded-xl border border-primary/20 bg-primary/10 text-primary font-bold text-sm"
            >
              Enviar foto do aparelho
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarFileChange}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">@username</label>
            <input
              type="text"
              value={draftUsername}
              onChange={(e) => {
                setDraftUsername(e.target.value);
                setProfileError('');
                setProfileSuccessMessage('');
              }}
              placeholder="seu.username"
              className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-12 px-4 text-sm focus:outline-none focus:border-primary transition-all"
            />
            <p className="text-[11px] text-slate-400">Permitido: letras, numeros, ponto, hifen e underscore.</p>
          </div>
          {profileError && (
            <p className="text-xs text-red-300">{profileError}</p>
          )}
          {profileSuccessMessage && (
            <p className="text-xs text-emerald-300">{profileSuccessMessage}</p>
          )}
          <button
            type="button"
            onClick={handleSaveProfile}
            className="w-full h-11 rounded-xl border border-primary/20 bg-primary text-background-dark font-bold text-sm"
          >
            Salvar perfil
          </button>
        </div>
      )}
      <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3">
        <button
          type="button"
          onClick={() => setIsPasswordSectionOpen(prev => !prev)}
          className="w-full flex items-center justify-between gap-3 text-left"
          aria-expanded={isPasswordSectionOpen}
        >
          <div className="space-y-1">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Segurança</h3>
            <p className="text-[11px] text-slate-400">Atualize sua senha quando quiser.</p>
          </div>
          <ChevronDown
            size={18}
            className={`text-primary transition-transform ${isPasswordSectionOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {isPasswordSectionOpen && (
          <div className="space-y-3 pt-2 border-t border-white/10">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Senha atual</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/60" size={18} />
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => {
                    setCurrentPassword(event.target.value);
                    setPasswordError('');
                    setPasswordSuccessMessage('');
                  }}
                  placeholder="Digite sua senha atual"
                  className="w-full min-w-0 bg-primary/5 border border-primary/20 rounded-2xl h-12 pl-12 pr-12 text-sm focus:outline-none focus:border-primary transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(prev => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/60 hover:text-primary transition-colors p-1"
                  aria-label={showCurrentPassword ? 'Ocultar senha atual' : 'Mostrar senha atual'}
                  title={showCurrentPassword ? 'Ocultar senha atual' : 'Mostrar senha atual'}
                >
                  {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Nova senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/60" size={18} />
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    setPasswordError('');
                    setPasswordSuccessMessage('');
                  }}
                  placeholder="Digite a nova senha"
                  className="w-full min-w-0 bg-primary/5 border border-primary/20 rounded-2xl h-12 pl-12 pr-12 text-sm focus:outline-none focus:border-primary transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(prev => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/60 hover:text-primary transition-colors p-1"
                  aria-label={showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  title={showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Confirmar senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/60" size={18} />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setPasswordError('');
                    setPasswordSuccessMessage('');
                  }}
                  placeholder="Confirme a nova senha"
                  className="w-full min-w-0 bg-primary/5 border border-primary/20 rounded-2xl h-12 pl-12 pr-12 text-sm focus:outline-none focus:border-primary transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(prev => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/60 hover:text-primary transition-colors p-1"
                  aria-label={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  title={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">Recomendado: usar pelo menos 8 caracteres.</p>
            </div>
            {passwordError && (
              <p className="text-xs text-red-300">{passwordError}</p>
            )}
            {passwordSuccessMessage && (
              <p className="text-xs text-emerald-300">{passwordSuccessMessage}</p>
            )}
            <button
              type="button"
              onClick={() => void handleChangePassword()}
              disabled={isUpdatingPassword}
              className="w-full h-11 rounded-xl border border-primary/20 bg-primary text-background-dark font-bold text-sm disabled:opacity-50"
            >
              {isUpdatingPassword ? 'Atualizando...' : 'Atualizar senha'}
            </button>
          </div>
        )}
      </div>
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Estatísticas do Montanhista</h3>
        <div className="p-4 rounded-2xl border border-white/10 bg-white/5">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Maior altitude conquistada</p>
          {highestConqueredPeak ? (
            <p className="text-sm font-bold text-primary mt-2">
              {highestConqueredPeak.name} - {highestConqueredPeak.altitude_metros} m
            </p>
          ) : (
            <p className="text-sm text-slate-400 mt-2">Sem conquistas de pico registradas.</p>
          )}
        </div>
        <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-2">
          <p className="text-sm text-slate-200">• {userStatsByType.pico} picos conquistados</p>
          <p className="text-sm text-slate-200">• {userExploredRangesCount} regiões exploradas</p>
          <p className="text-sm text-slate-200">• {userConqueredRangesCount} regiões conquistadas</p>
          <p className="text-sm text-slate-200">• {userStatsByType.morro} morros conquistados</p>
          <p className="text-sm text-slate-200">• {userStatsByType.trilha} trilhas concluídas</p>
          <p className="text-sm text-slate-200">• {userStatsByType.ilha} ilhas exploradas</p>
          <p className="text-sm text-slate-200">• {userStatsByType.cachoeira} cachoeiras visitadas</p>
        </div>
      </div>

      {user.role === 'ADMIN' && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Ações Administrativas</h3>
          <div className="grid grid-cols-2 gap-4">
            <AdminActionCard icon={<Users size={24} />} label="Ranking" />
            <AdminActionCard icon={<Mountain size={24} />} label="Regiões" />
            <AdminActionCard icon={<BookOpen size={24} />} label="Diário" />
            <AdminActionCard icon={<Target size={24} />} label="Metas" />
          </div>
          {isCloudEnabled && (
            <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Usuários que já logaram</p>
              {isLoadingRegisteredUsers ? (
                <p className="text-xs text-slate-400">Carregando usuários...</p>
              ) : registeredUsers.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum usuário registrado ainda.</p>
              ) : (
                <div className="space-y-2">
                  {registeredUsers.map(cloudUser => (
                    <div key={cloudUser.username} className="flex min-w-0 items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-slate-200">
                        {cloudUser.display_name} <span className="text-slate-500">@{cloudUser.username}</span>
                      </span>
                      <span className={`shrink-0 font-bold ${cloudUser.role === 'ADMIN' ? 'text-primary' : 'text-slate-400'}`}>
                        {cloudUser.role}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Glossário</h3>
        <div className="space-y-3">
          {GLOSSARY_ITEMS.map(item => (
            <div
              key={item.term}
              className="p-4 rounded-2xl border border-white/10 bg-white/5"
            >
              <p className="text-sm font-bold text-primary">{item.term}</p>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>
      </div>

      {user.role === 'ADMIN' && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Backup</h3>
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3">
            <button
              type="button"
              onClick={onExportBackup}
              className="w-full h-11 rounded-xl border border-primary/20 bg-primary/10 text-primary font-bold text-sm flex items-center justify-center gap-2 hover:bg-primary/20 transition-colors"
            >
              <Download size={16} />
              Exportar Backup
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={isImportingBackup}
              className="w-full h-11 rounded-xl border border-emerald-400/25 bg-emerald-500/10 text-emerald-300 font-bold text-sm flex items-center justify-center gap-2 hover:bg-emerald-500/20 transition-colors disabled:opacity-60"
            >
              <Upload size={16} />
              {isImportingBackup ? 'Importando...' : 'Importar Backup'}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportBackupFile}
            />
            <p className="text-[11px] text-slate-400">
              Exporta e restaura dados completos (locais, checks, participantes e datas).
            </p>
          </div>
        </div>
      )}

      <button 
        onClick={onLogout}
        className="w-full bg-red-500/10 text-red-500 font-bold h-14 rounded-2xl border border-red-500/20 flex items-center justify-center gap-2 hover:bg-red-500/20 transition-all"
      >
        <LogOut size={20} />
        Sair da Conta
      </button>
    </div>
  );
}

function AdminActionCard({ icon, label }: { icon: React.ReactNode, label: string }) {
  return (
    <button className="flex flex-col items-center justify-center p-6 bg-neutral-forest/40 rounded-2xl border border-white/5 hover:border-primary/20 transition-all group">
      <div className="text-slate-400 group-hover:text-primary transition-colors mb-2">
        {icon}
      </div>
      <span className="text-xs font-bold text-slate-300">{label}</span>
    </button>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-colors ${active ? 'text-primary' : 'text-slate-500'}`}
    >
      <div className={active ? 'fill-current' : ''}>
        {icon}
      </div>
      <span className="text-[10px] font-bold tracking-tighter uppercase">{label}</span>
    </button>
  );
}

function CreateModal({ title, placeholder, onClose, onSave }: { title: string, placeholder: string, onClose: () => void, onSave: (name: string) => void }) {
  const [name, setName] = useState('');

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
    >
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="w-full max-w-xs bg-neutral-forest p-6 rounded-3xl border border-primary/20 space-y-6"
      >
        <h2 className="text-xl font-bold text-center">{title}</h2>
        <input 
          autoFocus
          type="text" 
          placeholder={placeholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-14 px-4 text-sm focus:outline-none focus:border-primary transition-all"
        />
        <div className="flex gap-3">
          <button 
            onClick={onClose}
            className="flex-1 h-12 rounded-2xl border border-white/10 text-slate-400 font-bold text-sm"
          >
            Cancelar
          </button>
          <button 
            onClick={() => name && onSave(name)}
            className="flex-1 h-12 rounded-2xl bg-primary text-background-dark font-bold text-sm"
          >
            Salvar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function PeakFormModal({
  title,
  submitLabel,
  mountainRanges,
  initialName = '',
  initialRangeId,
  initialLocalType = getSuggestedLocalTypeForRange(initialRangeId),
  initialAltitudeMetros = null,
  initialDropHeightMetros = null,
  onClose,
  onSave,
}: {
  title: string,
  submitLabel: string,
  mountainRanges: MountainRange[],
  initialName?: string,
  initialRangeId: string,
  initialLocalType?: LocalType,
  initialAltitudeMetros?: number | null,
  initialDropHeightMetros?: number | null,
  onClose: () => void,
  onSave: (data: {
    name: string,
    rangeId: string,
    localType: LocalType,
    altitude_metros: number | null,
    altura_queda_metros: number | null,
  }) => void
}) {
  const [name, setName] = useState(initialName);
  const [rangeId, setRangeId] = useState(initialRangeId);
  const [localType, setLocalType] = useState<LocalType>(initialLocalType);
  const [altitudeInput, setAltitudeInput] = useState(
    typeof initialAltitudeMetros === 'number' ? String(initialAltitudeMetros) : '',
  );
  const [dropHeightInput, setDropHeightInput] = useState(
    typeof initialDropHeightMetros === 'number' ? String(initialDropHeightMetros) : '',
  );

  const parseMetersInput = (rawValue: string) => {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue) {
      return { value: null as number | null, valid: true };
    }

    const parsedValue = Number(trimmedValue);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      return { value: null as number | null, valid: false };
    }

    return { value: Math.round(parsedValue), valid: true };
  };

  const showAltitudeField = usesAltitudeByLocalType(localType);
  const altitudeParsed = showAltitudeField
    ? parseMetersInput(altitudeInput)
    : { value: null as number | null, valid: true };
  const dropHeightParsed = parseMetersInput(dropHeightInput);
  const hasInvalidNumericInput =
    !altitudeParsed.valid || (localType === 'cachoeira' && !dropHeightParsed.valid);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="w-full max-w-sm bg-neutral-forest p-6 rounded-3xl border border-primary/20 space-y-6 max-h-[90vh] overflow-y-auto no-scrollbar"
      >
        <h2 className="text-xl font-bold text-center">{title}</h2>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Nome do Local
            </label>
            <input
              autoFocus
              type="text"
              placeholder="Ex: Morro Anhangava"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-12 px-4 text-sm focus:outline-none focus:border-primary transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Região / Grupo
            </label>
            <select
              value={rangeId}
              onChange={(e) => {
                const nextRangeId = e.target.value;
                setRangeId(nextRangeId);

                if (nextRangeId === ISLAND_RANGE_ID && localType === 'pico') {
                  setLocalType('ilha');
                }

                if (nextRangeId !== ISLAND_RANGE_ID && localType === 'ilha') {
                  setLocalType('pico');
                }
              }}
              className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-12 px-4 text-sm text-white focus:outline-none focus:border-primary transition-all"
            >
              {mountainRanges.map(range => (
                <option
                  key={range.id}
                  value={range.id}
                  style={{ color: '#0f172a', backgroundColor: '#ffffff' }}
                >
                  {range.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Tipo
            </label>
            <select
              value={localType}
              onChange={(e) => setLocalType(e.target.value as LocalType)}
              className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-12 px-4 text-sm text-white focus:outline-none focus:border-primary transition-all"
            >
              <option value="pico" style={{ color: '#0f172a', backgroundColor: '#ffffff' }}>Pico</option>
              <option value="morro" style={{ color: '#0f172a', backgroundColor: '#ffffff' }}>Morro</option>
              <option value="trilha" style={{ color: '#0f172a', backgroundColor: '#ffffff' }}>Trilha</option>
              <option value="ilha" style={{ color: '#0f172a', backgroundColor: '#ffffff' }}>Ilha</option>
              <option value="cachoeira" style={{ color: '#0f172a', backgroundColor: '#ffffff' }}>Cachoeira</option>
            </select>
          </div>

          {showAltitudeField && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Altitude (m)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                placeholder="Ex: 1538"
                value={altitudeInput}
                onChange={(e) => setAltitudeInput(e.target.value)}
                className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-12 px-4 text-sm focus:outline-none focus:border-primary transition-all"
              />
            </div>
          )}

          {localType === 'cachoeira' && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Altura da Queda (m)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                placeholder="Ex: 70"
                value={dropHeightInput}
                onChange={(e) => setDropHeightInput(e.target.value)}
                className="w-full bg-primary/5 border border-primary/20 rounded-2xl h-12 px-4 text-sm focus:outline-none focus:border-primary transition-all"
              />
            </div>
          )}

          {hasInvalidNumericInput && (
            <p className="text-[11px] text-rose-300">
              Preencha os campos numéricos com valores válidos (0 ou maior).
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-12 rounded-2xl border border-white/10 text-slate-400 font-bold text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              if (!name.trim() || !rangeId || hasInvalidNumericInput) {
                return;
              }

              onSave({
                name,
                rangeId,
                localType,
                altitude_metros: showAltitudeField ? altitudeParsed.value : null,
                altura_queda_metros: localType === 'cachoeira' ? dropHeightParsed.value : null,
              });
            }}
            className="flex-1 h-12 rounded-2xl bg-primary text-background-dark font-bold text-sm"
          >
            {submitLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function HomeScreen({
  user,
  mountainRanges,
  participantNameMap,
  onViewAllSerras,
  onOpenProfile,
}: {
  user: User,
  mountainRanges: MountainRange[],
  participantNameMap: Map<string, string>,
  onViewAllSerras: () => void,
  onOpenProfile: () => void,
}) {
  const scopedMountainRanges = scopeMountainRangesForUser(mountainRanges, user, participantNameMap);
  const isPeakCompletedByUser = (peak: Peak) => peak.completions.length > 0;

  const rangePicoStats = scopedMountainRanges.map(range => {
    const peaks = Array.isArray(range.peaks) ? range.peaks : [];
    const picoPeaks = peaks.filter(peak => resolvePeakLocalType(peak) === 'pico');
    const totalPicos = picoPeaks.length;
    const completedPicos = picoPeaks.filter(isPeakCompletedByUser).length;

    return {
      id: range.id,
      name: range.name,
      totalPicos,
      completedPicos,
    };
  });

  const totalPeaks = rangePicoStats.reduce((acc, range) => acc + range.totalPicos, 0);
  const completedPeaks = rangePicoStats.reduce((acc, range) => acc + range.completedPicos, 0);
  const progress = totalPeaks > 0 ? (completedPeaks / totalPeaks) : 0;
  const progressPercent = Math.round(progress * 100);
  const topRangesByChecks = [...rangePicoStats]
    .sort((a, b) => {
      if (b.completedPicos !== a.completedPicos) {
        return b.completedPicos - a.completedPicos;
      }

      const progressA = a.totalPicos > 0 ? a.completedPicos / a.totalPicos : 0;
      const progressB = b.totalPicos > 0 ? b.completedPicos / b.totalPicos : 0;
      if (progressB !== progressA) {
        return progressB - progressA;
      }

      return a.name.localeCompare(b.name, 'pt-BR');
    })
    .slice(0, 3);

  const allPeaks = scopedMountainRanges.flatMap(range => (Array.isArray(range.peaks) ? range.peaks : []));
  const totalCheckins = allPeaks.reduce((acc, peak) => acc + peak.completions.length, 0);
  const statsByLocalType = LOCAL_TYPES.reduce((acc, localType) => {
    const localTypePeaks = allPeaks.filter(peak => resolvePeakLocalType(peak) === localType);
    acc[localType] = {
      completed: localTypePeaks.filter(isPeakCompletedByUser).length,
      total: localTypePeaks.length,
    };
    return acc;
  }, {} as Record<LocalType, { completed: number; total: number }>);
  const exploredRanges = scopedMountainRanges.filter(range => {
    const peaks = Array.isArray(range.peaks) ? range.peaks : [];
    return peaks.some(isPeakCompletedByUser);
  }).length;
  const totalRanges = scopedMountainRanges.length;
  const highestAltitudeConquered = allPeaks
    .filter(
      peak => isPeakCompletedByUser(peak) && typeof peak.altitude_metros === 'number',
    )
    .sort((a, b) => {
      const altitudeDifference = (b.altitude_metros as number) - (a.altitude_metros as number);
      if (altitudeDifference !== 0) {
        return altitudeDifference;
      }
      return a.name.localeCompare(b.name, 'pt-BR');
    })[0] ?? null;

  return (
    <div className="w-full min-w-0 overflow-x-hidden p-4 pt-6 sm:p-6 sm:pt-8 space-y-8">
      {/* Header */}
      <header className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-12 shrink-0 rounded-full border-2 border-primary overflow-hidden p-0.5">
            <AvatarImage
              src={user.avatar}
              alt={user.name}
              className="w-full h-full object-cover rounded-full"
            />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-primary/80 uppercase tracking-widest">Bem-vindo de volta,</p>
            <h1 className="break-words text-xl font-bold leading-tight">Olá, {user.name}!</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenProfile}
          className="bg-primary/10 p-2 rounded-xl text-primary border border-primary/20"
          aria-label="Abrir perfil"
          title="Abrir perfil"
        >
          <Bell size={20} />
        </button>
      </header>

      {/* Dashboard */}
      <section className="w-full min-w-0 overflow-hidden bg-neutral-forest/40 rounded-2xl p-4 sm:p-6 border border-primary/20 backdrop-blur-sm">
        <div className="mb-6 flex min-w-0 items-center justify-between gap-3">
          <h2 className="min-w-0 text-lg font-bold flex items-center gap-2">
            <LayoutDashboard size={20} className="text-primary" />
            <span className="truncate">Picos Conquistados</span>
          </h2>
          <button
            type="button"
            onClick={onViewAllSerras}
            className="shrink-0 text-primary text-xs font-bold uppercase tracking-widest hover:text-primary/80 transition-colors"
          >
            Ver mais
          </button>
        </div>

        <div className="flex flex-col items-center mb-8">
          <div className="relative size-44 flex items-center justify-center">
            <svg className="size-full transform -rotate-90">
              <circle 
                cx="88" cy="88" r="76" 
                className="text-slate-900" 
                stroke="currentColor" strokeWidth="12" fill="transparent" 
              />
              <circle 
                cx="88" cy="88" r="76" 
                className="text-primary" 
                stroke="currentColor" strokeWidth="12" fill="transparent" 
                strokeDasharray={477}
                strokeDashoffset={477 * (1 - progress)}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="text-3xl font-bold">{completedPeaks} / {totalPeaks}</span>
              <span className="text-xl font-black text-primary leading-none mt-1">{progressPercent}%</span>
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">concluído</span>
            </div>
          </div>
          <p className="text-xs text-slate-400 font-medium mt-4 text-center">
            Meta: conquistar todos os picos do Paraná
          </p>
        </div>

        <div className="space-y-4">
          {topRangesByChecks.map(range => (
            <div key={range.id}>
              <ProgressItem label={range.name} current={range.completedPicos} total={range.totalPicos} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">Estatísticas do Trilheiro</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <HikerStatisticCard
            icon={<MountainSnow size={22} strokeWidth={2.5} />}
            label="Picos"
            completed={statsByLocalType.pico.completed}
            total={statsByLocalType.pico.total}
          />
          <HikerStatisticCard
            icon={<Triangle size={20} strokeWidth={2.5} />}
            label="Morros"
            completed={statsByLocalType.morro.completed}
            total={statsByLocalType.morro.total}
          />
          <HikerStatisticCard
            icon={<Waves size={22} strokeWidth={2.5} />}
            label="Cachoeiras"
            completed={statsByLocalType.cachoeira.completed}
            total={statsByLocalType.cachoeira.total}
          />
          <HikerStatisticCard
            icon={<Route size={22} strokeWidth={2.5} />}
            label="Trilhas"
            completed={statsByLocalType.trilha.completed}
            total={statsByLocalType.trilha.total}
          />
          <HikerStatisticCard
            icon={<MapIcon size={22} strokeWidth={2.5} />}
            label="Ilhas"
            completed={statsByLocalType.ilha.completed}
            total={statsByLocalType.ilha.total}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">Check-ins</h2>
        <div className="bg-neutral-forest/40 rounded-2xl p-5 border border-white/10">
          <p className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <CheckCircle2 size={18} className="text-primary" />
            <span>Check-ins totais</span>
          </p>
          <p className="text-2xl font-black text-primary mt-2">
            {totalCheckins} <span className="text-sm font-bold text-slate-400">atividades registradas</span>
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">Regiões Exploradas</h2>
        <div className="bg-neutral-forest/40 rounded-2xl p-5 border border-white/10">
          <p className="text-sm font-bold text-slate-200">🧭 Regiões exploradas</p>
          <p className="text-2xl font-black text-primary mt-2">{exploredRanges} / {totalRanges} regiões</p>
        </div>
      </section>

      {highestAltitudeConquered && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold">Maior altitude conquistada</h2>
          <div className="bg-neutral-forest/40 rounded-2xl p-5 border border-white/10">
            <p className="text-3xl font-black text-primary">{highestAltitudeConquered.altitude_metros} m</p>
            <p className="text-sm font-bold text-slate-200 mt-1">{highestAltitudeConquered.name}</p>
          </div>
        </section>
      )}
    </div>
  );
}

function ProgressItem({ label, current, total }: { label: string, current: number, total: number }) {
  const percentage = total > 0 ? (current / total) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 items-start justify-between gap-3 text-xs font-bold">
        <span className="min-w-0 break-words text-slate-300">{label}</span>
        <span className="shrink-0 text-primary">{current}/{total}</span>
      </div>
      <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-white/5">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="bg-primary h-full rounded-full" 
        />
      </div>
    </div>
  );
}

function HikerStatisticCard({
  icon,
  label,
  completed,
  total,
  className = '',
}: {
  icon: React.ReactNode;
  label: string;
  completed: number;
  total: number;
  className?: string;
}) {
  const progressPercent = total > 0 ? Math.min(100, (completed / total) * 100) : 0;

  return (
    <div className={`min-w-0 overflow-hidden rounded-[1.75rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_50%),linear-gradient(180deg,rgba(4,20,8,0.96),rgba(2,12,5,0.92))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] ${className}`}>
      <div className="mb-3 flex size-8 items-center justify-center rounded-lg border border-primary/15 bg-primary/5 text-primary" aria-hidden>
        {icon}
      </div>
      <p className="break-words text-sm font-bold text-slate-200">{label}</p>
      <div className="mt-3 flex items-end gap-1.5">
        <span className="text-2xl font-black text-primary leading-none">{completed}</span>
        <span className="text-sm text-slate-400 leading-none mb-0.5">/ {total}</span>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary via-lime-300 to-emerald-200 transition-all"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}

function SerrasScreen({ 
  user,
  participantNameMap,
  mountainRanges, 
  onTogglePeak, 
  onDeleteCompletion,
  onAddPeak,
  onEditPeak,
  onAddRange,
  onDeletePeak,
  onDeleteRange,
  canManageCatalog,
  canDeleteCompletion,
  canViewCompletion,
  onBack
}: { 
  user: User,
  participantNameMap: Map<string, string>,
  mountainRanges: MountainRange[], 
  onTogglePeak: (rangeId: string, peakId: string, completionId?: string) => void,
  onDeleteCompletion: (rangeId: string, peakId: string, completionId: string) => void,
  onAddPeak: (rangeId: string) => void,
  onEditPeak: (rangeId: string, peakId: string) => void,
  onAddRange: () => void,
  onDeletePeak: (rangeId: string, peakId: string) => void,
  onDeleteRange: (rangeId: string) => void,
  canManageCatalog: boolean,
  canDeleteCompletion: (completion: PeakCompletion) => boolean,
  canViewCompletion: (completion: PeakCompletion) => boolean,
  onBack: () => void
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DONE' | 'TODO'>('ALL');
  const [expandedRangeId, setExpandedRangeId] = useState<string | null>(null);

  const normalizedSearchTerm = normalizeText(searchTerm);
  const scopedMountainRanges = scopeMountainRangesForUser(mountainRanges, user, participantNameMap);
  const filteredRanges = scopedMountainRanges
    .map(range => {
      const rangeMatchesSearch = normalizeText(range.name).includes(normalizedSearchTerm);
      const peaks = range.peaks.filter(peak => {
        const peakStatusMatches =
          statusFilter === 'ALL' ||
          (statusFilter === 'DONE' ? peak.completions.length > 0 : peak.completions.length === 0);
        const peakMatchesSearch = normalizeText(peak.name).includes(normalizedSearchTerm);
        const searchMatches = !normalizedSearchTerm || rangeMatchesSearch || peakMatchesSearch;
        return peakStatusMatches && searchMatches;
      });

      if (peaks.length === 0) {
        const shouldShowEmptyRange =
          statusFilter !== 'DONE' &&
          (!normalizedSearchTerm || rangeMatchesSearch);

        return shouldShowEmptyRange
          ? {
              ...range,
              peaks: [],
            }
          : null;
      }

      return {
        ...range,
        peaks,
      };
    })
    .filter((range): range is MountainRange => range !== null);

  useEffect(() => {
    if (!expandedRangeId) {
      return;
    }

    const stillVisible = filteredRanges.some(range => range.id === expandedRangeId);
    if (!stillVisible) {
      setExpandedRangeId(null);
    }
  }, [expandedRangeId, filteredRanges]);

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <header className="sticky top-0 z-20 bg-background-dark/95 backdrop-blur-md border-b border-primary/20 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} type="button" className="size-10 flex items-center justify-center rounded-full hover:bg-primary/10 transition-colors">
            <ChevronRight className="rotate-180" />
          </button>
          <h1 className="text-lg font-bold tracking-tight">Checklist de Regiões</h1>
          {canManageCatalog ? (
            <button 
              onClick={onAddRange}
              className="size-10 flex items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20"
            >
              <Plus size={20} />
            </button>
          ) : (
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 border border-white/10 rounded-lg px-2 py-1">
              {user.role}
            </div>
          )}
        </div>
        
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-primary" size={18} />
          <input 
            type="text" 
            placeholder="Buscar local ou região..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-primary/5 border border-primary/20 rounded-xl h-12 pl-12 pr-4 text-sm focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          <FilterTab label="Todas" active={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')} />
          <FilterTab label="Feitas" active={statusFilter === 'DONE'} onClick={() => setStatusFilter('DONE')} />
          <FilterTab label="A Fazer" active={statusFilter === 'TODO'} onClick={() => setStatusFilter('TODO')} />
        </div>
      </header>

      <div className="space-y-4 overflow-x-hidden p-4">
        {filteredRanges.length > 0 ? (
          filteredRanges.map(range => (
            <MountainRangeAccordion 
              key={range.id} 
              range={range} 
              isOpen={expandedRangeId === range.id}
              onToggle={() => setExpandedRangeId(current => (current === range.id ? null : range.id))}
              onTogglePeak={onTogglePeak} 
              onDeleteCompletion={onDeleteCompletion}
              onAddPeak={() => onAddPeak(range.id)}
              onEditPeak={(peakId) => onEditPeak(range.id, peakId)}
              onDeletePeak={(peakId) => onDeletePeak(range.id, peakId)}
              onDeleteRange={() => onDeleteRange(range.id)}
              canManageCatalog={canManageCatalog}
              canDeleteCompletion={canDeleteCompletion}
              canViewCompletion={canViewCompletion}
              participantNameMap={participantNameMap}
            />
          ))
        ) : (
          <div className="py-10 text-center bg-white/5 rounded-2xl border border-dashed border-white/10">
            <p className="text-slate-400 text-sm italic">Nenhum resultado para esse filtro.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterTab({ label, active = false, onClick }: { label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={`px-6 h-9 rounded-full text-sm font-bold transition-all ${active ? 'bg-primary text-background-dark shadow-lg shadow-primary/20' : 'bg-primary/5 text-primary border border-primary/20'}`}
    >
      {label}
    </button>
  );
}

interface MountainRangeAccordionProps {
  range: MountainRange;
  isOpen: boolean;
  onToggle: () => void;
}

function MountainRangeAccordion({ 
  range, 
  isOpen,
  onToggle,
  onTogglePeak,
  onDeleteCompletion,
  onAddPeak,
  onEditPeak,
  onDeletePeak,
  onDeleteRange,
  canManageCatalog,
  canDeleteCompletion,
  canViewCompletion,
  participantNameMap,
}: MountainRangeAccordionProps & { 
  onTogglePeak: (rangeId: string, peakId: string, completionId?: string) => void,
  onDeleteCompletion: (rangeId: string, peakId: string, completionId: string) => void,
  onAddPeak: () => void,
  onEditPeak: (peakId: string) => void,
  onDeletePeak: (peakId: string) => void,
  onDeleteRange: () => void,
  canManageCatalog: boolean,
  canDeleteCompletion: (completion: PeakCompletion) => boolean,
  canViewCompletion: (completion: PeakCompletion) => boolean,
  participantNameMap: Map<string, string>,
}) {
  const percentage = range.totalPeaks > 0 ? (range.completedPeaks / range.totalPeaks) * 100 : 0;
  const peaksByType: Record<LocalType, Peak[]> = {
    pico: [],
    morro: [],
    trilha: [],
    ilha: [],
    cachoeira: [],
  };

  range.peaks.forEach(peak => {
    peaksByType[resolvePeakLocalType(peak)].push(peak);
  });

  const orderedTypes = Object.keys(LOCAL_TYPE_ORDER)
    .sort((a, b) => LOCAL_TYPE_ORDER[a as LocalType] - LOCAL_TYPE_ORDER[b as LocalType]) as LocalType[];
  const typesWithItems = orderedTypes.filter(localType => peaksByType[localType].length > 0);
  const waterfallCount = peaksByType.cachoeira.length;

  return (
    <div className={`bg-primary/5 border border-primary/20 rounded-2xl overflow-hidden transition-all ${isOpen ? 'ring-1 ring-primary/40' : ''}`}>
      <div className="w-full p-4 space-y-3">
        <div className="flex items-center justify-between">
          <button 
            onClick={onToggle}
            className="flex items-center gap-2 font-bold text-left flex-1"
          >
            <Mountain size={18} className="text-primary" />
            {range.name}
            <ChevronDown className={`text-primary transition-transform ml-auto ${isOpen ? 'rotate-180' : ''}`} size={20} />
          </button>
          {canManageCatalog && (
            <button
              type="button"
              onClick={() => {
                const shouldDelete = window.confirm(`Excluir a região "${range.name}" e todos os locais dela?`);
                if (shouldDelete) {
                  onDeleteRange();
                }
              }}
              className="ml-2 size-8 rounded-lg flex items-center justify-center bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              aria-label={`Excluir região ${range.name}`}
              title="Excluir região"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <span>Progresso</span>
            <span>
              {range.completedPeaks} / {range.totalPeaks} locais
              {waterfallCount > 0 ? ` • ${waterfallCount} cachoeira(s)` : ''}
            </span>
          </div>
          <div className="w-full bg-primary/10 rounded-full h-2 overflow-hidden">
            <div className="bg-primary h-full rounded-full" style={{ width: `${percentage}%` }} />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-primary/5 p-4 pt-0 space-y-3"
          >
            <div className="pt-4 space-y-3">
              {range.peaks.length > 0 ? (
                <>
                  {typesWithItems.map(localType => {
                    const style = LOCAL_TYPE_STYLES[localType];
                    const label = LOCAL_TYPE_SECTION_LABELS[localType];
                    const peaks = peaksByType[localType];

                    return (
                      <div key={localType} className="space-y-3">
                        <p className={`text-[10px] font-bold uppercase tracking-widest ${style.sectionTitleClass}`}>
                          {label}
                        </p>

                        {peaks.map((peak: Peak) => {
                          const completionGroups = groupCompletionsByDate(peak.completions, participantNameMap);
                          const completionGroupCount = completionGroups.length;

                          return (
                          <div
                            key={peak.id}
                            className={`w-full flex flex-col p-3 rounded-xl border transition-all text-left ${
                              peak.completions.length > 0 ? style.cardCompletedClass : style.cardPendingClass
                            }`}
                          >
                            <div className="w-full flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1 flex flex-col">
                                <span className="break-words font-bold text-sm">{peak.name}</span>
                                <span className={`text-[9px] ${style.typeInfoClass}`}>
                                  {formatPeakMeta(peak)}
                                </span>
                                <span className={`text-[10px] font-bold ${peak.completions.length > 0 ? style.doneTextClass : 'text-slate-500'}`}>
                                  {peak.completions.length > 0
                                    ? `${completionGroupCount} ${localType === 'cachoeira' ? 'visita(s)' : 'presença(s)'}`
                                    : 'Pendente'}
                                </span>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                {canManageCatalog && (
                                  <>
                                    <button
                                      onClick={() => onEditPeak(peak.id)}
                                      type="button"
                                      className={`size-8 rounded-lg flex items-center justify-center transition-colors ${style.actionEditButtonClass}`}
                                      aria-label={`Editar ${peak.name}`}
                                      title="Editar local"
                                    >
                                      <Pencil size={15} />
                                    </button>
                                    <button
                                      onClick={() => {
                                        const shouldDelete = window.confirm(`Excluir o local "${peak.name}"?`);
                                        if (shouldDelete) {
                                          onDeletePeak(peak.id);
                                        }
                                      }}
                                      type="button"
                                      className="size-8 rounded-lg flex items-center justify-center transition-colors bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                                      aria-label={`Excluir ${peak.name}`}
                                      title="Excluir local"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={() => onTogglePeak(range.id, peak.id)}
                                  className={`size-8 rounded-lg flex items-center justify-center transition-colors ${style.actionAddButtonClass}`}
                                >
                                  <Plus size={18} />
                                </button>
                              </div>
                            </div>

                            {peak.completions.length > 0 && (
                              <div className={`mt-3 pt-3 border-t w-full space-y-3 ${style.completionBorderClass}`}>
                                {completionGroups.map((group: CompletionGroup) => {
                                  const visibleCompletion =
                                    group.completions.find(completion => canViewCompletion(completion)) ??
                                    group.completions[0];
                                  const manageableCompletion =
                                    group.completions.find(completion => canDeleteCompletion(completion)) ??
                                    (canManageCatalog ? group.completions[0] : undefined);
                                  const firstWikilocCompletion = group.completions.find(completion => completion.wikilocUrl);
                                  const canOpenGroup = Boolean(visibleCompletion && canViewCompletion(visibleCompletion));

                                  return (
                                  <div
                                    key={`${peak.id}-${group.date}`}
                                    className={`relative rounded-lg bg-black/20 p-2 pr-8 group transition-colors ${
                                      canOpenGroup ? 'cursor-pointer hover:bg-black/30' : 'cursor-default'
                                    }`}
                                    onClick={() => {
                                      if (visibleCompletion && canOpenGroup) {
                                        onTogglePeak(range.id, peak.id, visibleCompletion.id);
                                      }
                                    }}
                                  >
                                    {manageableCompletion && (canManageCatalog || canDeleteCompletion(manageableCompletion)) && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const message = peak.name
                                            ? `Excluir seu check-in de "${peak.name}" (${group.date})?`
                                            : `Excluir seu check-in (${group.date})?`;
                                          if (window.confirm(message)) {
                                            onDeleteCompletion(range.id, peak.id, manageableCompletion.id);
                                          }
                                        }}
                                        className="absolute right-2 top-2 z-10 flex size-5 items-center justify-center rounded-full bg-red-500 text-white opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                                      >
                                        <X size={10} />
                                      </button>
                                    )}
                                    <div className="flex justify-between items-start mb-1">
                                      <span className={`text-[10px] font-bold ${style.completionDateClass}`}>{group.date}</span>
                                      {firstWikilocCompletion?.wikilocUrl && (
                                        <a
                                          href={firstWikilocCompletion.wikilocUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className={`text-[9px] font-bold hover:underline flex items-center gap-1 ${style.completionLinkClass}`}
                                        >
                                          <MapIcon size={8} /> Wikiloc
                                        </a>
                                      )}
                                    </div>
                                    {group.participants.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {group.participants.map((p: string) => (
                                          <span
                                            key={p}
                                            className={`text-[8px] px-1.5 py-0.5 rounded-full border ${style.participantTagClass}`}
                                          >
                                            {p}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              ) : (
                <p className="text-slate-500 text-xs py-2 italic">Nenhum local cadastrado nesta região ainda.</p>
              )}
              
              {canManageCatalog && (
                <button 
                  onClick={onAddPeak}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-primary/30 text-primary/60 hover:text-primary hover:border-primary transition-all text-xs font-bold uppercase tracking-widest"
                >
                  <Plus size={16} />
                  Novo Cadastro
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RankingScreen({
  user,
  mountainRanges,
  participantNameMap,
  participantAvatarMap,
  adminIdentityKeys,
  onOpenProfile,
  onBack,
}: {
  user: User,
  mountainRanges: MountainRange[],
  participantNameMap: Map<string, string>,
  participantAvatarMap: Map<string, string>,
  adminIdentityKeys: Set<string>,
  onOpenProfile: () => void,
  onBack: () => void
}) {
  const parseBRDate = (dateValue: unknown) => {
    if (typeof dateValue !== 'string') {
      return 0;
    }

    const [day, month, year] = dateValue.split('/').map(Number);
    if (!day || !month || !year) {
      return 0;
    }

    const timestamp = new Date(year, month - 1, day).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const [rankingMode, setRankingMode] = useState<RankingMode>('GERAL');
  const [selectedLeaderId, setSelectedLeaderId] = useState<string | null>(null);
  const [isUserRankingSummaryExpanded, setIsUserRankingSummaryExpanded] = useState(false);
  const geralTabRef = useRef<HTMLButtonElement | null>(null);
  const picosTabRef = useRef<HTMLButtonElement | null>(null);
  const altitudeTabRef = useRef<HTMLButtonElement | null>(null);
  const serrasTabRef = useRef<HTMLButtonElement | null>(null);
  const checkinsTabRef = useRef<HTMLButtonElement | null>(null);
  let leadersByPicos: RankingLeader[] = [];
  let leadersByAltitude: RankingLeader[] = [];
  let leadersBySerras: RankingLeader[] = [];
  let leadersByCheckins: RankingLeader[] = [];
  let leadersByGeral: RankingLeader[] = [];
  let leaderTrailDetails = new Map<string, LeaderTrailScore[]>();
  let leaderAltitudeDetails = new Map<string, LeaderTrailScore[]>();
  let leaderConqueredRangeDetails = new Map<string, string[]>();
  let leaderCheckinDetails = new Map<string, LeaderCheckinDetail[]>();

  try {
    const metaRangeTargets = new Map<string, { name: string; targetLocalIds: Set<string> }>();
    const createParticipantStats = (name: string) => ({
      name,
      trails: new Map<string, LeaderTrailScore>(),
      highestAltitude: null as number | null,
      highestAltitudePeak: null as string | null,
      altitudeLocals: new Map<string, LeaderTrailScore>(),
      exploredRanges: new Map<string, string>(),
      conqueredRanges: new Map<string, string>(),
      completedMetaLocalsByRange: new Map<string, Set<string>>(),
      trilhas: new Set<string>(),
      cachoeiras: new Set<string>(),
      checkinsCount: 0,
      checkins: [] as LeaderCheckinDetail[],
      lastTrail: undefined as string | undefined,
      lastDate: 0,
    });

    const leaderboardMap = new Map<
      string,
      {
        name: string;
        trails: Map<string, LeaderTrailScore>;
        highestAltitude: number | null;
        highestAltitudePeak: string | null;
        altitudeLocals: Map<string, LeaderTrailScore>;
        exploredRanges: Map<string, string>;
        conqueredRanges: Map<string, string>;
        completedMetaLocalsByRange: Map<string, Set<string>>;
        trilhas: Set<string>;
        cachoeiras: Set<string>;
        checkinsCount: number;
        checkins: LeaderCheckinDetail[];
        lastTrail?: string;
        lastDate: number;
      }
    >();

    const safeRanges = Array.isArray(mountainRanges) ? mountainRanges : [];

    safeRanges.forEach(range => {
      const safeRangeId = typeof range?.id === 'string' ? range.id : 'range';
      const safeRangeName = typeof range?.name === 'string' ? range.name : 'Serra';
      const peaks = Array.isArray(range?.peaks) ? range.peaks : [];
      const targetLocalIds = new Set(
        peaks
          .filter(peak => {
            const localType = resolvePeakLocalType(peak);
            return localType === 'pico' || localType === 'morro';
          })
          .map(peak => peak.id),
      );
      metaRangeTargets.set(safeRangeId, { name: safeRangeName, targetLocalIds });

      peaks.forEach(peak => {
        const safePeakLocalType = resolvePeakLocalType(peak);
        const isPico = safePeakLocalType === 'pico';
        const safePeakId = typeof peak?.id === 'string' ? peak.id : 'peak';
        const safePeakName = typeof peak?.name === 'string' ? peak.name : 'Trilha';
        const safePeakAltitude = resolvePeakAltitude(peak);
        const trailId = `${safeRangeId}:${safePeakId}`;
        const trail: LeaderTrailScore | null = isPico
          ? {
              id: trailId,
              name: safePeakName,
              rangeName: safeRangeName,
              category: 'PEAK',
              localType: safePeakLocalType,
              altitude_metros: safePeakAltitude,
            }
          : null;
        const completions = Array.isArray(peak?.completions) ? peak.completions : [];

        completions.forEach((completion, completionIndex) => {
          const completionDate = parseBRDate((completion as PeakCompletion | undefined)?.date);
          const completionLabel = typeof (completion as PeakCompletion | undefined)?.date === 'string'
            ? (completion as PeakCompletion).date
            : '';
          const participants = Array.isArray((completion as PeakCompletion | undefined)?.participants)
            ? (completion as PeakCompletion).participants
            : [];

          participants.forEach(rawParticipant => {
            const rawParticipantKey = normalizeText(rawParticipant);
            const participantName = resolveParticipantDisplayName(rawParticipant, participantNameMap);
            if (!participantName) {
              return;
            }

            const participantKey = normalizeText(participantName);
            if (!participantKey) {
              return;
            }

            if (adminIdentityKeys.has(participantKey) || (rawParticipantKey && adminIdentityKeys.has(rawParticipantKey))) {
              return;
            }

            const participantStats = leaderboardMap.get(participantKey) ?? createParticipantStats(participantName);

            participantStats.checkinsCount += 1;
            participantStats.checkins.push({
              id: `${trailId}:${typeof (completion as PeakCompletion | undefined)?.id === 'string' ? (completion as PeakCompletion).id : completionIndex}`,
              name: safePeakName,
              rangeName: safeRangeName,
              localType: safePeakLocalType,
              date: completionLabel,
              timestamp: completionDate,
            });
            participantStats.exploredRanges.set(safeRangeId, safeRangeName);
            if (safePeakLocalType === 'pico' || safePeakLocalType === 'morro') {
              const completedMetaLocals = participantStats.completedMetaLocalsByRange.get(safeRangeId) ?? new Set<string>();
              completedMetaLocals.add(safePeakId);
              participantStats.completedMetaLocalsByRange.set(safeRangeId, completedMetaLocals);
            }

            if (trail) {
              participantStats.trails.set(trailId, trail);
            }
            if (typeof safePeakAltitude === 'number') {
              participantStats.altitudeLocals.set(trailId, {
                id: trailId,
                name: safePeakName,
                rangeName: safeRangeName,
                category: resolvePeakCategory(peak),
                localType: safePeakLocalType,
                altitude_metros: safePeakAltitude,
              });
            }
            if (safePeakLocalType === 'trilha') {
              participantStats.trilhas.add(trailId);
            }
            if (safePeakLocalType === 'cachoeira') {
              participantStats.cachoeiras.add(trailId);
            }

            if (typeof safePeakAltitude === 'number') {
              const currentHighest = participantStats.highestAltitude;
              const shouldUpdateHighest =
                currentHighest === null ||
                safePeakAltitude > currentHighest ||
                (
                  safePeakAltitude === currentHighest &&
                  (
                    !participantStats.highestAltitudePeak ||
                    safePeakName.localeCompare(participantStats.highestAltitudePeak, 'pt-BR') < 0
                  )
                );
              if (shouldUpdateHighest) {
                participantStats.highestAltitude = safePeakAltitude;
                participantStats.highestAltitudePeak = safePeakName;
              }
            }

            if (completionDate >= participantStats.lastDate) {
              participantStats.lastDate = completionDate;
              participantStats.lastTrail = safePeakName;
              participantStats.name = participantName;
            }

            leaderboardMap.set(participantKey, participantStats);
          });
        });
      });
    });

    leaderboardMap.forEach(stats => {
      metaRangeTargets.forEach((rangeTarget, rangeId) => {
        if (rangeTarget.targetLocalIds.size === 0) {
          return;
        }

        const completedMetaLocals = stats.completedMetaLocalsByRange.get(rangeId);
        if (completedMetaLocals && completedMetaLocals.size === rangeTarget.targetLocalIds.size) {
          stats.conqueredRanges.set(rangeId, rangeTarget.name);
        }
      });
    });

    const participantEntries = Array.from(leaderboardMap.entries());
    const altitudeParticipantEntries = participantEntries;
    const toRankingLeader = (
      participantKey: string,
      stats: {
        name: string;
        trails: Map<string, LeaderTrailScore>;
        highestAltitude: number | null;
        highestAltitudePeak: string | null;
        altitudeLocals: Map<string, LeaderTrailScore>;
        exploredRanges: Map<string, string>;
        conqueredRanges: Map<string, string>;
        trilhas: Set<string>;
        cachoeiras: Set<string>;
        checkinsCount: number;
        checkins: LeaderCheckinDetail[];
        lastTrail?: string;
      },
      rank: number,
    ): RankingLeader => {
      const normalizedName = normalizeText(stats.name);
      const seed = normalizedName || participantKey || `trilheiro-${rank}`;
      const avatar = participantAvatarMap.get(participantKey) ?? participantAvatarMap.get(normalizedName) ?? buildGeneratedAvatarUrl(seed);
      const picosCount = stats.trails.size;
      const altitudeTotal = Array.from(stats.altitudeLocals.values()).reduce(
        (acc, local) => acc + (typeof local.altitude_metros === 'number' ? local.altitude_metros : 0),
        0,
      );
      const exploredRangesCount = stats.exploredRanges.size;
      const conqueredRangesCount = stats.conqueredRanges.size;
      const trilhasCount = stats.trilhas.size;
      const cachoeirasCount = stats.cachoeiras.size;
      const checkinsCount = stats.checkinsCount;
      const score = (picosCount * 10) + (conqueredRangesCount * 30) + (trilhasCount * 5) + (cachoeirasCount * 3);

      return {
        id: participantKey,
        name: stats.name,
        peaks: picosCount,
        rank,
        avatar,
        lastPeak: stats.lastTrail,
        highestAltitude: stats.highestAltitude,
        highestAltitudePeak: stats.highestAltitudePeak,
        altitudeTotal,
        exploredRangesCount,
        conqueredRangesCount,
        trilhasCount,
        cachoeirasCount,
        checkinsCount,
        score,
      };
    };

    leadersByPicos = [...participantEntries]
      .sort((a, b) => {
        const aStats = a[1];
        const bStats = b[1];
        if (bStats.trails.size !== aStats.trails.size) return bStats.trails.size - aStats.trails.size;
        if (bStats.lastDate !== aStats.lastDate) return bStats.lastDate - aStats.lastDate;
        return aStats.name.localeCompare(bStats.name, 'pt-BR');
      })
      .map(([participantKey, stats], index) => toRankingLeader(participantKey, stats, index + 1));
    leadersByAltitude = altitudeParticipantEntries
      .sort((a, b) => {
        const aStats = a[1];
        const bStats = b[1];
        const altitudeTotalA = Array.from(aStats.altitudeLocals.values()).reduce(
          (acc, local) => acc + (typeof local.altitude_metros === 'number' ? local.altitude_metros : 0),
          0,
        );
        const altitudeTotalB = Array.from(bStats.altitudeLocals.values()).reduce(
          (acc, local) => acc + (typeof local.altitude_metros === 'number' ? local.altitude_metros : 0),
          0,
        );
        if (altitudeTotalB !== altitudeTotalA) {
          return altitudeTotalB - altitudeTotalA;
        }
        if ((bStats.highestAltitude ?? 0) !== (aStats.highestAltitude ?? 0)) {
          return (bStats.highestAltitude ?? 0) - (aStats.highestAltitude ?? 0);
        }
        if (bStats.trails.size !== aStats.trails.size) return bStats.trails.size - aStats.trails.size;
        if (bStats.lastDate !== aStats.lastDate) return bStats.lastDate - aStats.lastDate;
        return aStats.name.localeCompare(bStats.name, 'pt-BR');
      })
      .map(([participantKey, stats], index) => toRankingLeader(participantKey, stats, index + 1));
    leadersBySerras = participantEntries
      .sort((a, b) => {
        const aStats = a[1];
        const bStats = b[1];
        if (bStats.conqueredRanges.size !== aStats.conqueredRanges.size) {
          return bStats.conqueredRanges.size - aStats.conqueredRanges.size;
        }
        if (bStats.trails.size !== aStats.trails.size) {
          return bStats.trails.size - aStats.trails.size;
        }
        if ((bStats.highestAltitude ?? 0) !== (aStats.highestAltitude ?? 0)) {
          return (bStats.highestAltitude ?? 0) - (aStats.highestAltitude ?? 0);
        }
        if (bStats.lastDate !== aStats.lastDate) {
          return bStats.lastDate - aStats.lastDate;
        }
        return aStats.name.localeCompare(bStats.name, 'pt-BR');
      })
      .map(([participantKey, stats], index) => toRankingLeader(participantKey, stats, index + 1));
    leadersByCheckins = participantEntries
      .sort((a, b) => {
        const aStats = a[1];
        const bStats = b[1];
        if (bStats.checkinsCount !== aStats.checkinsCount) {
          return bStats.checkinsCount - aStats.checkinsCount;
        }
        if (bStats.trails.size !== aStats.trails.size) {
          return bStats.trails.size - aStats.trails.size;
        }
        if (bStats.lastDate !== aStats.lastDate) {
          return bStats.lastDate - aStats.lastDate;
        }
        return aStats.name.localeCompare(bStats.name, 'pt-BR');
      })
      .map(([participantKey, stats], index) => toRankingLeader(participantKey, stats, index + 1));
    leadersByGeral = participantEntries
      .sort((a, b) => {
        const aStats = a[1];
        const bStats = b[1];
        const scoreA = (aStats.trails.size * 10) + (aStats.conqueredRanges.size * 30) + (aStats.trilhas.size * 5) + (aStats.cachoeiras.size * 3);
        const scoreB = (bStats.trails.size * 10) + (bStats.conqueredRanges.size * 30) + (bStats.trilhas.size * 5) + (bStats.cachoeiras.size * 3);

        if (scoreB !== scoreA) return scoreB - scoreA;
        if (bStats.trails.size !== aStats.trails.size) return bStats.trails.size - aStats.trails.size;
        if (bStats.conqueredRanges.size !== aStats.conqueredRanges.size) return bStats.conqueredRanges.size - aStats.conqueredRanges.size;
        if ((bStats.highestAltitude ?? 0) !== (aStats.highestAltitude ?? 0)) return (bStats.highestAltitude ?? 0) - (aStats.highestAltitude ?? 0);
        if (bStats.lastDate !== aStats.lastDate) return bStats.lastDate - aStats.lastDate;
        return aStats.name.localeCompare(bStats.name, 'pt-BR');
      })
      .map(([participantKey, stats], index) => toRankingLeader(participantKey, stats, index + 1));

    leaderTrailDetails = new Map(
      Array.from(leaderboardMap.entries()).map(([participantKey, stats]) => [
        participantKey,
        Array.from(stats.trails.values()).sort((a, b) => {
          if (a.localType !== b.localType) {
            return LOCAL_TYPE_ORDER[a.localType] - LOCAL_TYPE_ORDER[b.localType];
          }

          const byRange = a.rangeName.localeCompare(b.rangeName, 'pt-BR');
          if (byRange !== 0) {
            return byRange;
          }

          return a.name.localeCompare(b.name, 'pt-BR');
        }),
      ]),
    );
    leaderAltitudeDetails = new Map(
      Array.from(leaderboardMap.entries()).map(([participantKey, stats]) => [
        participantKey,
        Array.from(stats.altitudeLocals.values()).sort((a, b) => {
          const altitudeA = typeof a.altitude_metros === 'number' ? a.altitude_metros : -1;
          const altitudeB = typeof b.altitude_metros === 'number' ? b.altitude_metros : -1;
          if (altitudeB !== altitudeA) {
            return altitudeB - altitudeA;
          }
          return a.name.localeCompare(b.name, 'pt-BR');
        }),
      ]),
    );
    leaderConqueredRangeDetails = new Map(
      Array.from(leaderboardMap.entries()).map(([participantKey, stats]) => [
        participantKey,
        Array.from(stats.conqueredRanges.values()).sort((a, b) => a.localeCompare(b, 'pt-BR')),
      ]),
    );
    leaderCheckinDetails = new Map(
      Array.from(leaderboardMap.entries()).map(([participantKey, stats]) => [
        participantKey,
        [...stats.checkins].sort((a, b) => {
          if (b.timestamp !== a.timestamp) {
            return b.timestamp - a.timestamp;
          }

          const byRange = a.rangeName.localeCompare(b.rangeName, 'pt-BR');
          if (byRange !== 0) {
            return byRange;
          }

          return a.name.localeCompare(b.name, 'pt-BR');
        }),
      ]),
    );
  } catch (error) {
    console.error('Erro ao montar ranking:', error);
    leadersByPicos = [];
    leadersByAltitude = [];
    leadersBySerras = [];
    leadersByCheckins = [];
    leadersByGeral = [];
    leaderTrailDetails = new Map();
    leaderAltitudeDetails = new Map();
    leaderConqueredRangeDetails = new Map();
    leaderCheckinDetails = new Map();
  }

  const leaders = rankingMode === 'PICOS'
    ? leadersByPicos
    : rankingMode === 'ALTITUDE'
      ? leadersByAltitude
      : rankingMode === 'SERRAS'
        ? leadersBySerras
        : rankingMode === 'CHECKINS'
          ? leadersByCheckins
          : leadersByGeral;
  const rankingTitle = rankingMode === 'PICOS'
    ? '🏆 Ranking de Picos'
    : rankingMode === 'ALTITUDE'
      ? '⛰ Ranking de Altitude'
      : rankingMode === 'SERRAS'
        ? '🧭 Regiões Conquistadas'
        : rankingMode === 'CHECKINS'
          ? '✅ Ranking de Check-ins'
          : '⭐ Ranking Geral';

  const top1 = leaders[0];
  const top2 = leaders[1];
  const top3 = leaders[2];
  const peakCountFrequency = leaders.reduce((acc, leader) => {
    const metricValue = rankingMode === 'PICOS'
      ? leader.peaks
      : rankingMode === 'ALTITUDE'
        ? leader.altitudeTotal
        : rankingMode === 'SERRAS'
          ? leader.conqueredRangesCount
          : rankingMode === 'CHECKINS'
            ? leader.checkinsCount
            : leader.score;
    acc.set(metricValue, (acc.get(metricValue) ?? 0) + 1);
    return acc;
  }, new Map<number, number>());
  const tiedPeakCounts = new Set(
    Array.from(peakCountFrequency.entries())
      .filter(([, count]) => count > 1)
      .map(([value]) => value),
  );
  const isTiedLeader = (leader?: RankingLeader) => {
    if (!leader) {
      return false;
    }

    const metricValue = rankingMode === 'PICOS'
      ? leader.peaks
      : rankingMode === 'ALTITUDE'
        ? leader.altitudeTotal
        : rankingMode === 'SERRAS'
          ? leader.conqueredRangesCount
          : rankingMode === 'CHECKINS'
            ? leader.checkinsCount
            : leader.score;
    return tiedPeakCounts.has(metricValue);
  };
  const selectedLeader = leaders.find(leader => leader.id === selectedLeaderId) ?? null;
  const selectedLeaderTrails = selectedLeader
    ? rankingMode === 'ALTITUDE'
      ? leaderAltitudeDetails.get(selectedLeader.id) ?? []
      : leaderTrailDetails.get(selectedLeader.id) ?? []
    : [];
  const selectedLeaderConqueredRanges = selectedLeader
    ? leaderConqueredRangeDetails.get(selectedLeader.id) ?? []
    : [];
  const selectedLeaderCheckins = selectedLeader
    ? leaderCheckinDetails.get(selectedLeader.id) ?? []
    : [];
  const currentUserRankingKeys = Array.from(
    new Set([normalizeText(user.name), normalizeText(user.username)].filter(Boolean)),
  );
  const currentUserLeaderInMode = leaders.find(leader => currentUserRankingKeys.includes(leader.id)) ?? null;
  const currentUserLeaderOverall =
    leadersByGeral.find(leader => currentUserRankingKeys.includes(leader.id)) ??
    leadersByCheckins.find(leader => currentUserRankingKeys.includes(leader.id)) ??
    leadersByPicos.find(leader => currentUserRankingKeys.includes(leader.id)) ??
    leadersBySerras.find(leader => currentUserRankingKeys.includes(leader.id)) ??
    leadersByAltitude.find(leader => currentUserRankingKeys.includes(leader.id)) ??
    null;
  const userPositionLabel = currentUserLeaderInMode
    ? `#${currentUserLeaderInMode.rank} de ${leaders.length} montanhistas`
    : `#-- de ${leaders.length} montanhistas`;
  const userPicosConquistados = currentUserLeaderOverall?.peaks ?? 0;
  const userSerrasExploradas = currentUserLeaderOverall?.exploredRangesCount ?? 0;
  const userSerrasConquistadas = currentUserLeaderOverall?.conqueredRangesCount ?? 0;
  const userCheckinsTotais = currentUserLeaderOverall?.checkinsCount ?? 0;
  const userMaiorAltitude = currentUserLeaderOverall?.highestAltitude ?? null;

  useEffect(() => {
    const activeTab = rankingMode === 'GERAL'
      ? geralTabRef.current
      : rankingMode === 'PICOS'
        ? picosTabRef.current
        : rankingMode === 'ALTITUDE'
          ? altitudeTabRef.current
          : rankingMode === 'SERRAS'
            ? serrasTabRef.current
            : checkinsTabRef.current;

    activeTab?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [rankingMode]);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-black/95 backdrop-blur-md border-b border-primary/20 p-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} type="button" className="size-10 flex items-center justify-center rounded-full hover:bg-primary/10 transition-colors">
            <ChevronRight className="rotate-180" />
          </button>
          <h1 className="text-lg font-bold tracking-tight uppercase">{rankingTitle}</h1>
          <button
            type="button"
            onClick={onOpenProfile}
            className="size-10 flex items-center justify-center rounded-full hover:bg-primary/10 transition-colors"
            aria-label="Abrir perfil"
            title="Abrir perfil"
          >
            <Settings size={20} />
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 pr-4 scroll-smooth snap-x snap-mandatory">
          <button
            ref={geralTabRef}
            type="button"
            onClick={() => setRankingMode('GERAL')}
            className={`h-9 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider border transition-colors whitespace-nowrap snap-start ${
              rankingMode === 'GERAL'
                ? 'bg-primary text-black border-primary'
                : 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
            }`}
          >
            ⭐ Geral
          </button>
          <button
            ref={picosTabRef}
            type="button"
            onClick={() => setRankingMode('PICOS')}
            className={`h-9 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider border transition-colors whitespace-nowrap snap-start ${
              rankingMode === 'PICOS'
                ? 'bg-primary text-black border-primary'
                : 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
            }`}
          >
            🏔 Picos
          </button>
          <button
            ref={altitudeTabRef}
            type="button"
            onClick={() => setRankingMode('ALTITUDE')}
            className={`h-9 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider border transition-colors whitespace-nowrap snap-start ${
              rankingMode === 'ALTITUDE'
                ? 'bg-primary text-black border-primary'
                : 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
            }`}
          >
            ⛰ Altitude
          </button>
          <button
            ref={serrasTabRef}
            type="button"
            onClick={() => setRankingMode('SERRAS')}
            className={`h-9 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider border transition-colors whitespace-nowrap snap-start ${
              rankingMode === 'SERRAS'
                ? 'bg-primary text-black border-primary'
                : 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
            }`}
          >
            📍 Serras Conquistadas
          </button>
          <button
            ref={checkinsTabRef}
            type="button"
            onClick={() => setRankingMode('CHECKINS')}
            className={`h-9 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider border transition-colors whitespace-nowrap snap-start ${
              rankingMode === 'CHECKINS'
                ? 'bg-primary text-black border-primary'
                : 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
            }`}
          >
            ✅ Check-ins
          </button>
        </div>
      </header>

      <div className="p-4 space-y-8">
        <section className="bg-neutral-forest/40 rounded-2xl p-5 border border-primary/20">
          <button
            type="button"
            onClick={() => setIsUserRankingSummaryExpanded(prev => !prev)}
            className="w-full flex items-center justify-between gap-3 text-left"
            aria-expanded={isUserRankingSummaryExpanded}
          >
            <div>
              <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Sua posição no ranking</p>
              <p className="text-2xl font-black text-primary mt-1">{userPositionLabel}</p>
            </div>
            <ChevronDown
              size={20}
              className={`text-primary transition-transform ${isUserRankingSummaryExpanded ? 'rotate-180' : ''}`}
            />
          </button>

          <AnimatePresence initial={false}>
            {isUserRankingSummaryExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-3 mt-3 border-t border-white/10 space-y-1.5">
                  <p className="text-sm text-slate-200">Picos conquistados: {userPicosConquistados}</p>
                  <p className="text-sm text-slate-200">Check-ins totais: {userCheckinsTotais}</p>
                  <p className="text-sm text-slate-200">Regiões exploradas: {userSerrasExploradas}</p>
                  <p className="text-sm text-slate-200">Regiões conquistadas: {userSerrasConquistadas}</p>
                  <p className="text-sm text-slate-200">
                    Maior altitude: {typeof userMaiorAltitude === 'number' ? `${userMaiorAltitude} m` : 'Sem registro'}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {leaders.length === 0 ? (
          <section className="pt-10">
            <div className="py-10 text-center bg-white/5 rounded-2xl border border-dashed border-white/10">
              <p className="text-slate-400 text-sm italic">
                {rankingMode === 'PICOS'
                  ? 'Sem ranking ainda. Cadastre participantes em picos para gerar pontuação.'
                  : rankingMode === 'ALTITUDE'
                    ? 'Sem ranking de altitude ainda. Registre conquistas em picos com altitude para gerar o ranking.'
                    : rankingMode === 'SERRAS'
                      ? 'Sem ranking de regiões conquistadas ainda. Complete todas as metas de uma região para pontuar aqui.'
                      : rankingMode === 'CHECKINS'
                        ? 'Sem ranking de check-ins ainda. Registre atividades para competir por frequência.'
                        : 'Sem ranking geral ainda. Registre conquistas para calcular a pontuação combinada.'}
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className="pt-16 grid grid-cols-3 items-end gap-3">
              {top2 ? <PodiumItem leader={top2} rank={2} height="h-20" mode={rankingMode} isTied={isTiedLeader(top2)} onViewTrails={() => setSelectedLeaderId(top2.id)} /> : <div className="min-h-[14rem]" />}
              {top1 ? <PodiumItem leader={top1} rank={1} height="h-28" mode={rankingMode} featured isTied={isTiedLeader(top1)} onViewTrails={() => setSelectedLeaderId(top1.id)} /> : <div className="min-h-[16rem]" />}
              {top3 ? <PodiumItem leader={top3} rank={3} height="h-16" mode={rankingMode} isTied={isTiedLeader(top3)} onViewTrails={() => setSelectedLeaderId(top3.id)} /> : <div className="min-h-[13rem]" />}
            </section>

            <section className="space-y-3">
              <h3 className="text-primary text-[10px] font-black uppercase tracking-[0.2em] px-1 mb-4">Demais Trilheiros</h3>
              {leaders.slice(3).map(leader => (
                <LeaderRow
                  key={leader.id}
                  leader={leader}
                  mode={rankingMode}
                  isTied={isTiedLeader(leader)}
                  onViewTrails={() => setSelectedLeaderId(leader.id)}
                />
              ))}
            </section>
          </>
        )}
      </div>

      <AnimatePresence>
        {selectedLeader && (
          <TrailScoreModal
            leader={selectedLeader}
            trails={selectedLeaderTrails}
            conqueredRanges={selectedLeaderConqueredRanges}
            checkins={selectedLeaderCheckins}
            mode={rankingMode}
            onClose={() => setSelectedLeaderId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
interface PodiumItemProps {
  leader: RankingLeader;
  rank: number;
  height: string;
  mode: RankingMode;
  featured?: boolean;
  isTied?: boolean;
  onViewTrails?: () => void;
}

function PodiumItem({ leader, rank, height, mode, featured = false, isTied = false, onViewTrails }: PodiumItemProps) {
  const borderColor = rank === 1 ? 'border-primary' : rank === 2 ? 'border-slate-400' : 'border-amber-700';
  const shadowColor = rank === 1 ? 'shadow-primary/40' : rank === 2 ? 'shadow-slate-400/30' : 'shadow-amber-700/30';
  const scoreLabel = mode === 'PICOS'
    ? `${leader.peaks} picos`
    : mode === 'ALTITUDE'
      ? (leader.altitudeTotal > 0 ? `${leader.altitudeTotal} m` : 'Sem altitude')
      : mode === 'SERRAS'
        ? `${leader.conqueredRangesCount}`
        : mode === 'CHECKINS'
          ? `${leader.checkinsCount} check-ins`
          : `${leader.score} pts`;

  return (
    <div className={`flex min-w-0 flex-col items-center ${featured ? 'scale-110 sm:scale-[1.08]' : ''}`}>
      <div className="relative mb-3">
        {featured && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-primary animate-pulse">
            <Trophy size={28} fill="currentColor" />
          </div>
        )}
        <div className={`size-20 rounded-full border-4 ${borderColor} overflow-hidden bg-white/5 shadow-lg ${shadowColor}`}>
          <AvatarImage src={leader.avatar} alt={leader.name} className="w-full h-full object-cover" />
        </div>
        <div className={`absolute -bottom-2 -right-1 size-7 rounded-full flex items-center justify-center border-2 border-black text-[10px] font-bold ${rank === 1 ? 'bg-primary text-black' : 'bg-slate-800 text-white'}`}>
          {rank}
        </div>
      </div>
      <p className="font-bold text-center text-xs leading-snug break-words w-full">{leader.name}</p>
      <p className="text-primary text-[10px] font-bold">{scoreLabel}</p>
      {mode === 'SERRAS' && (
        <p className="text-[9px] text-primary font-bold uppercase tracking-tighter">Regiões Conquistadas</p>
      )}
      {mode === 'CHECKINS' && (
        <p className="text-[9px] text-primary font-bold uppercase tracking-tighter">Atividades Registradas</p>
      )}
      {mode === 'ALTITUDE' && leader.highestAltitudePeak && (
        <p className="text-[9px] text-slate-400 truncate w-full text-center">({leader.highestAltitudePeak})</p>
      )}
      {mode === 'GERAL' && (
        <p className="text-[9px] text-slate-400 truncate w-full text-center">
          {leader.peaks}p • {leader.conqueredRangesCount}sc • {leader.trilhasCount}t • {leader.cachoeirasCount}ca • {leader.checkinsCount}ci
        </p>
      )}
      {isTied && (
        <span className="mt-1 text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
          Empatado
        </span>
      )}
      <button
        type="button"
        onClick={onViewTrails}
        className="mt-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
      >
        <BookOpen size={10} />
        Detalhes
      </button>
      <div className={`w-full ${height} bg-primary/10 rounded-t-xl mt-2 border-x border-t border-primary/20`} />
    </div>
  );
}

interface LeaderRowProps {
  leader: RankingLeader;
  mode: RankingMode;
  isTied?: boolean;
  onViewTrails: () => void;
  key?: React.Key;
}

function LeaderRow({ leader, mode, isTied = false, onViewTrails }: LeaderRowProps) {
  const scoreLabel = mode === 'PICOS'
    ? `${leader.peaks}`
    : mode === 'ALTITUDE'
      ? (leader.altitudeTotal > 0 ? `${leader.altitudeTotal} m` : 'Sem altitude')
      : mode === 'SERRAS'
        ? `${leader.conqueredRangesCount}`
        : mode === 'CHECKINS'
          ? `${leader.checkinsCount}`
          : `${leader.score} pts`;

  return (
    <div className="bg-white/5 border border-primary/10 p-4 rounded-2xl flex items-center gap-4 hover:border-primary/30 transition-all group">
      <span className="text-slate-600 font-bold w-4 group-hover:text-primary transition-colors">{leader.rank}</span>
      <div className="size-12 rounded-full border-2 border-primary/20 overflow-hidden bg-black">
        <AvatarImage src={leader.avatar} alt={leader.name} className="w-full h-full object-cover" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-col items-start gap-1">
          <p className="font-bold text-sm leading-snug break-words w-full">{leader.name}</p>
          {isTied && (
            <span className="text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
              Empatado
            </span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0 min-w-[118px]">
        <p className="font-black text-lg leading-none">{scoreLabel}</p>
        {mode === 'PICOS' ? (
          <p className="text-[9px] text-primary font-bold uppercase tracking-tighter">Picos</p>
        ) : mode === 'ALTITUDE' ? (
          <p className="text-[9px] text-primary font-bold uppercase tracking-tighter">
            {leader.highestAltitudePeak ? `(${leader.highestAltitudePeak})` : 'Altitude'}
          </p>
        ) : mode === 'SERRAS' ? (
          <p className="text-[9px] text-primary font-bold uppercase tracking-tighter">Regiões Conquistadas</p>
        ) : mode === 'CHECKINS' ? (
          <p className="text-[9px] text-primary font-bold uppercase tracking-tighter">Check-ins</p>
        ) : (
          <p className="text-[9px] text-primary font-bold uppercase tracking-tighter">Score</p>
        )}
        <button
          type="button"
          onClick={onViewTrails}
          className="mt-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <BookOpen size={10} />
          Detalhes
        </button>
      </div>
    </div>
  );
}

function TrailScoreModal({
  leader,
  trails,
  conqueredRanges,
  checkins,
  mode,
  onClose,
}: {
  leader: RankingLeader;
  trails: LeaderTrailScore[];
  conqueredRanges: string[];
  checkins: LeaderCheckinDetail[];
  mode: RankingMode;
  onClose: () => void;
}) {
  const trailsToRender = mode === 'ALTITUDE'
    ? [...trails].sort((a, b) => {
        const altitudeA = typeof a.altitude_metros === 'number' ? a.altitude_metros : -1;
        const altitudeB = typeof b.altitude_metros === 'number' ? b.altitude_metros : -1;
        if (altitudeB !== altitudeA) {
          return altitudeB - altitudeA;
        }
        return a.name.localeCompare(b.name, 'pt-BR');
      })
    : trails;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 20 }}
        className="w-full max-w-sm bg-neutral-forest p-6 rounded-3xl border border-primary/20 space-y-5 max-h-[90vh] overflow-y-auto no-scrollbar"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold text-primary uppercase tracking-widest">
              {mode === 'SERRAS'
                ? 'Regiões Conquistadas'
                : mode === 'GERAL'
                  ? 'Score Geral'
                  : mode === 'ALTITUDE'
                    ? 'Locais com Altitude'
                    : mode === 'CHECKINS'
                      ? 'Check-ins Totais'
                      : 'Picos Conquistados'}
            </p>
            <h2 className="text-lg font-bold leading-tight">{leader.name}</h2>
            {mode === 'GERAL' ? (
              <p className="text-xs text-primary mt-1">{leader.score} pts</p>
            ) : mode === 'CHECKINS' ? (
              <p className="text-xs text-primary mt-1">{leader.checkinsCount} atividade(s) registrada(s)</p>
            ) : mode === 'SERRAS' ? (
              <p className="text-xs text-slate-400 mt-1">{conqueredRanges.length} serra(s) conquistada(s)</p>
            ) : mode === 'ALTITUDE' ? (
              <p className="text-xs text-primary mt-1">
                {leader.altitudeTotal > 0
                  ? `Altitude acumulada: ${leader.altitudeTotal} m`
                  : 'Altitude acumulada: Sem altitude'}
              </p>
            ) : (
              <p className="text-xs text-slate-400 mt-1">{trails.length} pico(s) contabilizado(s)</p>
            )}
          </div>
          <button onClick={onClose} type="button" className="text-slate-500 hover:text-white">
            <X size={22} />
          </button>
        </div>

        {mode === 'GERAL' ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Fórmula do Score</p>
              <p className="text-xs text-slate-300">{leader.peaks} picos × 10 = {leader.peaks * 10}</p>
              <p className="text-xs text-slate-300">{leader.conqueredRangesCount} regiões conquistadas × 30 = {leader.conqueredRangesCount * 30}</p>
              <p className="text-xs text-slate-300">{leader.trilhasCount} trilhas × 5 = {leader.trilhasCount * 5}</p>
              <p className="text-xs text-slate-300">{leader.cachoeirasCount} cachoeiras × 3 = {leader.cachoeirasCount * 3}</p>
              <p className="text-xs text-slate-400">Check-ins totais: {leader.checkinsCount} (nao alteram o score)</p>
              <p className="text-sm font-bold text-primary pt-1 border-t border-primary/20">Total: {leader.score} pts</p>
            </div>
          </div>
        ) : mode === 'CHECKINS' ? (
          checkins.length === 0 ? (
            <div className="py-8 text-center bg-white/5 rounded-2xl border border-dashed border-white/10">
              <p className="text-slate-400 text-sm italic">Sem check-ins para este trilheiro.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {checkins.map(checkin => (
                <div key={checkin.id} className="rounded-xl border border-primary/15 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold leading-tight">{checkin.name}</p>
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary">
                      {getLocalTypeLabel(checkin.localType)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {checkin.rangeName}{checkin.date ? ` • ${checkin.date}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )
        ) : mode === 'SERRAS' ? (
          conqueredRanges.length === 0 ? (
            <div className="py-8 text-center bg-white/5 rounded-2xl border border-dashed border-white/10">
              <p className="text-slate-400 text-sm italic">Sem regiões conquistadas para este trilheiro.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {conqueredRanges.map(rangeName => (
                <div key={rangeName} className="rounded-xl border border-primary/15 bg-black/20 p-3">
                  <p className="text-sm font-bold leading-tight">{rangeName}</p>
                </div>
              ))}
            </div>
          )
        ) : trails.length === 0 ? (
          <div className="py-8 text-center bg-white/5 rounded-2xl border border-dashed border-white/10">
            <p className="text-slate-400 text-sm italic">
              {mode === 'ALTITUDE'
                ? 'Sem locais com altitude registrada para este trilheiro.'
                : 'Sem picos registrados para este trilheiro.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {trailsToRender.map(trail => (
              <div key={trail.id} className="rounded-xl border border-primary/15 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold leading-tight">{trail.name}</p>
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${trail.localType === 'cachoeira' ? 'border-sky-400/40 bg-sky-500/10 text-sky-300' : 'border-primary/30 bg-primary/10 text-primary'}`}>
                    {getLocalTypeLabel(trail.localType)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {mode === 'ALTITUDE'
                    ? `${trail.rangeName} • ${typeof trail.altitude_metros === 'number' ? `${trail.altitude_metros} m` : 'Sem altitude'}`
                    : trail.rangeName}
                </p>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

