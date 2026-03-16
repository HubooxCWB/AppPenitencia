import { MountainRange } from './types';

const RAW_SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const SUPABASE_PUBLIC_KEY = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  '',
).trim();
const SUPABASE_ANON_JWT = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const SUPABASE_URL = RAW_SUPABASE_URL.replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 8000;

const hasCloudConfig = Boolean(SUPABASE_URL && SUPABASE_PUBLIC_KEY);

export type CloudLoadResult =
  | { status: 'ok'; ranges: MountainRange[] }
  | { status: 'empty' }
  | { status: 'error'; httpStatus?: number };

export interface CloudAppUser {
  auth_user_id?: string | null;
  email?: string | null;
  username: string;
  display_name: string;
  role: 'ADMIN' | 'USER' | string;
  avatar_url?: string | null;
  is_active?: boolean;
  last_login_at?: string | null;
  created_at?: string;
}

export interface CloudAuthProfile {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  role: 'ADMIN' | 'USER';
}

interface SupabaseAuthUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

interface SupabaseAuthSession {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: SupabaseAuthUser;
}

const AUTH_SESSION_STORAGE_KEY = 'penitencia-supabase-auth-session';
const DEFAULT_ADMIN_USERNAME = 'penitencia';
const DEFAULT_ADMIN_EMAIL = 'huboox.rec@gmail.com';
const ADMIN_EMAIL = String(import.meta.env.VITE_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase() || DEFAULT_ADMIN_EMAIL;
const ADMIN_USERNAME = String(import.meta.env.VITE_ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME).trim().toLowerCase() || DEFAULT_ADMIN_USERNAME;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const readStoredAuthSession = (): SupabaseAuthSession | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawSession = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!rawSession) {
      return null;
    }

    const parsed = JSON.parse(rawSession) as unknown;
    const parsedRecord = asRecord(parsed);
    return parsedRecord ? (parsedRecord as SupabaseAuthSession) : null;
  } catch {
    return null;
  }
};

const persistAuthSession = (session: SupabaseAuthSession) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
};

const clearStoredAuthSession = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
};

const getMetadataString = (user: SupabaseAuthUser | null | undefined, key: string): string | null => {
  const metadata = asRecord(user?.user_metadata);
  if (!metadata) {
    return null;
  }

  const value = metadata[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const deriveUsernameFromEmail = (email: string): string => {
  const localPart = email.split('@')[0] ?? '';
  const sanitized = localPart
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/g, '');

  return sanitized || 'trilheiro';
};

const buildAuthProfile = (user: SupabaseAuthUser | null | undefined): CloudAuthProfile | null => {
  const email = String(user?.email ?? '').trim().toLowerCase();
  if (!email) {
    return null;
  }

  const username =
    getMetadataString(user, 'username') ??
    deriveUsernameFromEmail(email);
  const displayName =
    getMetadataString(user, 'display_name') ??
    getMetadataString(user, 'name') ??
    username;
  const avatarUrl =
    getMetadataString(user, 'avatar_url') ??
    `https://picsum.photos/seed/${encodeURIComponent(username || 'hiker')}/200/200`;
  const isAdmin = Boolean(
    (ADMIN_EMAIL && email === ADMIN_EMAIL) ||
    username === ADMIN_USERNAME,
  );

  return {
    id: user?.id ?? username,
    email,
    username,
    displayName,
    avatarUrl,
    role: isAdmin ? 'ADMIN' : 'USER',
  };
};

const toSupabaseAuthUser = (value: unknown): SupabaseAuthUser | undefined => {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string') {
    return undefined;
  }

  return {
    id: record.id,
    email: typeof record.email === 'string' ? record.email : null,
    user_metadata: asRecord(record.user_metadata),
  };
};

const parseAuthResponseError = async (
  response: Response,
  fallbackMessage: string,
): Promise<string> => {
  try {
    const payload = (await response.json()) as unknown;
    const record = asRecord(payload);
    if (!record) {
      return fallbackMessage;
    }

    const messageCandidate = record.error_description ?? record.message ?? record.error ?? record.msg;
    if (typeof messageCandidate === 'string' && messageCandidate.trim()) {
      return messageCandidate.trim();
    }

    return fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

const isSessionExpired = (session: SupabaseAuthSession): boolean => {
  if (typeof session.expires_at !== 'number') {
    return false;
  }

  const expiresAtMs = session.expires_at * 1000;
  const nowMs = Date.now();

  // Refresh slightly before expiration to avoid race conditions.
  return expiresAtMs <= nowMs + 30_000;
};

const parseSnapshotRanges = (payload: unknown): MountainRange[] | null => {
  if (Array.isArray(payload)) {
    return payload as MountainRange[];
  }

  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const candidates: unknown[] = [
    record.get_snapshot,
    record.getSnapshot,
    record.payload,
    record.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as MountainRange[];
    }
  }

  return null;
};

const looksLikeJwt = (value: string) => /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(value);

const buildRequestHeaders = () => {
  const headers: Record<string, string> = {
    apikey: SUPABASE_PUBLIC_KEY,
    'Content-Type': 'application/json',
  };

  const sessionAccessToken = readStoredAuthSession()?.access_token;

  // Prefer user session token when available (authenticated role).
  if (typeof sessionAccessToken === 'string' && looksLikeJwt(sessionAccessToken)) {
    headers.Authorization = `Bearer ${sessionAccessToken}`;
  } else if (looksLikeJwt(SUPABASE_ANON_JWT)) {
    // Fallback to anon JWT when configured.
    headers.Authorization = `Bearer ${SUPABASE_ANON_JWT}`;
  } else if (looksLikeJwt(SUPABASE_PUBLIC_KEY)) {
    // Compatibility fallback.
    headers.Authorization = `Bearer ${SUPABASE_PUBLIC_KEY}`;
  }

  return headers;
};

const buildAuthApiHeaders = () => ({
  apikey: SUPABASE_PUBLIC_KEY,
  'Content-Type': 'application/json',
});

const buildAuthBearerHeaders = (accessToken: string) => ({
  ...buildAuthApiHeaders(),
  Authorization: `Bearer ${accessToken}`,
});

const fetchWithTimeout = async (url: string, options: RequestInit) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
};

export const isCloudSyncEnabled = () => hasCloudConfig;

export const loadRangesFromCloud = async (): Promise<CloudLoadResult> => {
  if (!hasCloudConfig) {
    return { status: 'error' };
  }

  try {
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/rpc/get_snapshot`,
      {
        method: 'POST',
        headers: buildRequestHeaders(),
        body: '{}',
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error('[cloudSync] loadRangesFromCloud failed', response.status, errorBody);
      return { status: 'error', httpStatus: response.status };
    }

    const payload = (await response.json()) as unknown;
    const ranges = parseSnapshotRanges(payload);
    if (!ranges) {
      return { status: 'error' };
    }

    if (ranges.length === 0) {
      return { status: 'empty' };
    }

    return { status: 'ok', ranges };
  } catch {
    console.error('[cloudSync] loadRangesFromCloud failed: network/timeout');
    return { status: 'error' };
  }
};

export const saveRangesToCloud = async (ranges: MountainRange[]): Promise<void> => {
  if (!hasCloudConfig) {
    return;
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/replace_snapshot`, {
      method: 'POST',
      headers: {
        ...buildRequestHeaders(),
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ payload: ranges }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error('[cloudSync] saveRangesToCloud failed', response.status, errorBody);
    }
  } catch {
    console.error('[cloudSync] saveRangesToCloud failed: network/timeout');
  }
};

const fetchAuthUser = async (accessToken: string): Promise<SupabaseAuthUser | null> => {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'GET',
    headers: buildAuthBearerHeaders(accessToken),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as unknown;
  const record = asRecord(payload);
  if (!record || typeof record.id !== 'string') {
    return null;
  }

  return {
    id: record.id,
    email: typeof record.email === 'string' ? record.email : null,
    user_metadata: asRecord(record.user_metadata),
  };
};

const refreshAuthSession = async (refreshToken: string): Promise<SupabaseAuthSession | null> => {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: buildAuthApiHeaders(),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as unknown;
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  return {
    access_token: typeof record.access_token === 'string' ? record.access_token : undefined,
    refresh_token: typeof record.refresh_token === 'string' ? record.refresh_token : undefined,
    expires_at: typeof record.expires_at === 'number' ? record.expires_at : undefined,
    expires_in: typeof record.expires_in === 'number' ? record.expires_in : undefined,
    user: toSupabaseAuthUser(record.user),
  };
};

export const restoreSupabaseAuthProfile = async (): Promise<CloudAuthProfile | null> => {
  if (!hasCloudConfig) {
    return null;
  }

  try {
    const storedSession = readStoredAuthSession();
    if (!storedSession?.access_token) {
      return null;
    }

    let activeSession = storedSession;
    if (isSessionExpired(activeSession)) {
      if (!activeSession.refresh_token) {
        clearStoredAuthSession();
        return null;
      }

      const refreshedSession = await refreshAuthSession(activeSession.refresh_token);
      if (!refreshedSession?.access_token) {
        clearStoredAuthSession();
        return null;
      }

      activeSession = refreshedSession;
      persistAuthSession(activeSession);
    }

    const authUser = await fetchAuthUser(activeSession.access_token);
    if (!authUser) {
      clearStoredAuthSession();
      return null;
    }

    const profile = buildAuthProfile(authUser);
    if (!profile) {
      clearStoredAuthSession();
      return null;
    }

    const mergedSession: SupabaseAuthSession = {
      ...activeSession,
      user: authUser,
    };
    persistAuthSession(mergedSession);

    return profile;
  } catch {
    clearStoredAuthSession();
    return null;
  }
};

export const signInWithSupabaseAuth = async (params: {
  email: string;
  password: string;
}): Promise<{ ok: true; profile: CloudAuthProfile } | { ok: false; message: string }> => {
  if (!hasCloudConfig) {
    return { ok: false, message: 'Supabase não está configurado.' };
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: buildAuthApiHeaders(),
      body: JSON.stringify({
        email: params.email,
        password: params.password,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        message: await parseAuthResponseError(response, 'Não foi possível entrar com este e-mail e senha.'),
      };
    }

    const payload = (await response.json()) as unknown;
    const record = asRecord(payload);
    if (!record) {
      return { ok: false, message: 'Resposta inválida do Supabase Auth.' };
    }

    const session: SupabaseAuthSession = {
      access_token: typeof record.access_token === 'string' ? record.access_token : undefined,
      refresh_token: typeof record.refresh_token === 'string' ? record.refresh_token : undefined,
      expires_at: typeof record.expires_at === 'number' ? record.expires_at : undefined,
      expires_in: typeof record.expires_in === 'number' ? record.expires_in : undefined,
      user: toSupabaseAuthUser(record.user),
    };

    if (!session.access_token || !session.user) {
      return { ok: false, message: 'Sessão inválida retornada pelo Supabase Auth.' };
    }

    const profile = buildAuthProfile(session.user);
    if (!profile) {
      return { ok: false, message: 'Perfil do usuário inválido.' };
    }

    persistAuthSession(session);
    return { ok: true, profile };
  } catch {
    return { ok: false, message: 'Falha de conexão com o Supabase Auth.' };
  }
};

export const signUpWithSupabaseAuth = async (params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ ok: true; profile: CloudAuthProfile } | { ok: false; message: string }> => {
  if (!hasCloudConfig) {
    return { ok: false, message: 'Supabase não está configurado.' };
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: buildAuthApiHeaders(),
      body: JSON.stringify({
        email: params.email,
        password: params.password,
        data: {
          display_name: params.displayName ?? '',
        },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        message: await parseAuthResponseError(response, 'Não foi possível criar sua conta.'),
      };
    }

    const payload = (await response.json()) as unknown;
    const record = asRecord(payload);
    if (!record) {
      return { ok: false, message: 'Resposta inválida do Supabase Auth.' };
    }

    const sessionRecord = asRecord(record.session);
    const session: SupabaseAuthSession = {
      access_token: typeof sessionRecord?.access_token === 'string' ? sessionRecord.access_token : undefined,
      refresh_token: typeof sessionRecord?.refresh_token === 'string' ? sessionRecord.refresh_token : undefined,
      expires_at: typeof sessionRecord?.expires_at === 'number' ? sessionRecord.expires_at : undefined,
      expires_in: typeof sessionRecord?.expires_in === 'number' ? sessionRecord.expires_in : undefined,
      user: toSupabaseAuthUser(record.user),
    };

    if (!session.access_token || !session.user) {
      // Some Supabase projects return `session: null` on signup depending on email-confirm settings.
      // Try immediate sign-in to avoid blocking users when confirmation is actually disabled.
      const autoLogin = await signInWithSupabaseAuth({
        email: params.email,
        password: params.password,
      });

      if (autoLogin.ok) {
        return autoLogin;
      }

      const lowerMsg = ('message' in autoLogin ? autoLogin.message : '').toLowerCase();
      if (
        lowerMsg.includes('confirm') ||
        lowerMsg.includes('verified') ||
        lowerMsg.includes('not confirmed')
      ) {
        return {
          ok: false,
          message: 'Conta criada. Seu projeto ainda exige confirmação de e-mail. Em Supabase Auth, desative "Confirmar e-mail" e clique em "Salvar alterações".',
        };
      }

      return {
        ok: false,
        message: 'Conta criada, mas não foi possível entrar automaticamente. Tente entrar manualmente com o mesmo e-mail e senha.',
      };
    }

    const profile = buildAuthProfile(session.user);
    if (!profile) {
      return { ok: false, message: 'Perfil do usuário inválido.' };
    }

    persistAuthSession(session);
    return { ok: true, profile };
  } catch {
    return { ok: false, message: 'Falha de conexão com o Supabase Auth.' };
  }
};

export const signOutSupabaseAuth = async (): Promise<void> => {
  if (!hasCloudConfig) {
    clearStoredAuthSession();
    return;
  }

  const session = readStoredAuthSession();
  const accessToken = session?.access_token;

  if (!accessToken) {
    clearStoredAuthSession();
    return;
  }

  try {
    await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: buildAuthBearerHeaders(accessToken),
      body: '{}',
    });
  } catch {
    // no-op; local session will still be cleared.
  } finally {
    clearStoredAuthSession();
  }
};

export const updateSupabaseAuthPassword = async (
  newPassword: string,
): Promise<{ ok: true } | { ok: false; message: string }> => {
  if (!hasCloudConfig) {
    return { ok: false, message: 'Supabase não está configurado.' };
  }

  const accessToken = readStoredAuthSession()?.access_token;
  if (!accessToken) {
    return { ok: false, message: 'Sessão inválida. Faça login novamente.' };
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: buildAuthBearerHeaders(accessToken),
      body: JSON.stringify({
        password: newPassword,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        message: await parseAuthResponseError(response, 'Não foi possível atualizar a senha.'),
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: 'Falha de conexão ao atualizar a senha.' };
  }
};

export const updateSupabaseAuthProfile = async (params: {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}): Promise<{ ok: true; profile: CloudAuthProfile } | { ok: false; message: string }> => {
  if (!hasCloudConfig) {
    return { ok: false, message: 'Supabase não está configurado.' };
  }

  const session = readStoredAuthSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return { ok: false, message: 'Sessão inválida. Faça login novamente.' };
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: buildAuthBearerHeaders(accessToken),
      body: JSON.stringify({
        data: {
          ...(typeof params.username === 'string' ? { username: params.username } : {}),
          ...(typeof params.displayName === 'string' ? { display_name: params.displayName } : {}),
          ...(typeof params.avatarUrl === 'string' ? { avatar_url: params.avatarUrl } : {}),
        },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        message: await parseAuthResponseError(response, 'Não foi possível atualizar o perfil.'),
      };
    }

    const payload = (await response.json()) as unknown;
    const updatedUser = toSupabaseAuthUser(payload);
    const profile = buildAuthProfile(updatedUser);
    if (!updatedUser || !profile) {
      return { ok: false, message: 'Perfil do usuário inválido.' };
    }

    persistAuthSession({
      ...(session ?? {}),
      access_token: accessToken,
      refresh_token: session?.refresh_token,
      expires_at: session?.expires_at,
      expires_in: session?.expires_in,
      user: updatedUser,
    });

    return { ok: true, profile };
  } catch {
    return { ok: false, message: 'Falha de conexão ao atualizar o perfil.' };
  }
};

export const upsertCloudUser = async (payload: {
  authUserId: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}): Promise<void> => {
  if (!hasCloudConfig) {
    return;
  }

  try {
    await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/upsert_app_user`, {
      method: 'POST',
      headers: buildRequestHeaders(),
      body: JSON.stringify({
        p_auth_user_id: payload.authUserId,
        p_email: payload.email,
        p_username: payload.username,
        p_display_name: payload.displayName,
        p_avatar_url: payload.avatarUrl ?? null,
      }),
    });
  } catch {
    // no-op for MVP
  }
};

export const listCloudUsers = async (): Promise<CloudAppUser[] | null> => {
  if (!hasCloudConfig) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/list_app_users`, {
      method: 'POST',
      headers: buildRequestHeaders(),
      body: '{}',
    });

    if (!response.ok) {
      return null;
    }

    const rows = (await response.json()) as unknown;
    return Array.isArray(rows) ? (rows as CloudAppUser[]) : null;
  } catch {
    return null;
  }
};

export const listParticipantDirectory = async (): Promise<CloudAppUser[] | null> => {
  if (!hasCloudConfig) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/list_participant_directory`, {
      method: 'POST',
      headers: buildRequestHeaders(),
      body: '{}',
    });

    if (!response.ok) {
      return null;
    }

    const rows = (await response.json()) as unknown;
    return Array.isArray(rows) ? (rows as CloudAppUser[]) : null;
  } catch {
    return null;
  }
};
