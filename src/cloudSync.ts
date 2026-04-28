import { MountainRange } from './types';

const RAW_SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const SUPABASE_PUBLIC_KEY = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  '',
).trim();
const SUPABASE_ANON_JWT = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const SUPABASE_URL = RAW_SUPABASE_URL.replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 15000;

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

export interface CloudParticipantUser {
  username: string;
  display_name: string;
  role?: 'ADMIN' | 'USER' | string;
  avatar_url?: string | null;
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

export const buildGeneratedAvatarUrl = (_seed: string) => '';

export const isGeneratedAvatarUrl = (avatarUrl: string | null | undefined, seed: string) =>
  String(avatarUrl ?? '').trim().toLowerCase().includes('picsum.photos/') ||
  String(avatarUrl ?? '').trim() === buildGeneratedAvatarUrl(seed);

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
    getMetadataString(user, 'picture') ??
    '';

  return {
    id: user?.id ?? username,
    email,
    username,
    displayName,
    avatarUrl,
    role: 'USER',
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
  const translateAuthErrorMessage = (message: string) => {
    const normalizedMessage = message
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

    if (
      normalizedMessage.includes('invalid login credentials') ||
      normalizedMessage.includes('email not confirmed') ||
      normalizedMessage.includes('invalid email or password')
    ) {
      return 'E-mail ou senha invÃ¡lidos.';
    }

    if (normalizedMessage.includes('user already registered')) {
      return 'JÃ¡ existe uma conta cadastrada com este e-mail.';
    }

    if (
      normalizedMessage.includes('password should be at least') ||
      normalizedMessage.includes('password is too short')
    ) {
      return 'A senha deve ter pelo menos 6 caracteres.';
    }

    if (normalizedMessage.includes('signup is disabled')) {
      return 'O cadastro estÃ¡ desativado no momento.';
    }

    if (
      normalizedMessage.includes('email rate limit exceeded') ||
      normalizedMessage.includes('rate limit') ||
      normalizedMessage.includes('too many requests')
    ) {
      return 'Muitas tentativas em sequÃªncia. Aguarde um pouco e tente novamente.';
    }

    if (normalizedMessage.includes('same password')) {
      return 'A nova senha precisa ser diferente da senha atual.';
    }

    if (normalizedMessage.includes('weak password')) {
      return 'Escolha uma senha mais forte para continuar.';
    }

    if (normalizedMessage.includes('forbidden') || normalizedMessage.includes('permission denied')) {
      return 'Sua sessÃ£o expirou ou vocÃª nÃ£o tem permissÃ£o para este check-in. Entre novamente e tente de novo.';
    }

    if (
      normalizedMessage.includes('idx_completions_individual_daily_checkin') ||
      normalizedMessage.includes('duplicate key value violates unique constraint') ||
      normalizedMessage.includes('23505')
    ) {
      return 'Voce ja tem um check-in neste local nessa data. Edite o check-in existente ou escolha outra data.';
    }

    return message;
  };

  try {
    const payload = (await response.json()) as unknown;
    const record = asRecord(payload);
    if (!record) {
      return fallbackMessage;
    }

    const messageCandidate = record.error_description ?? record.message ?? record.error ?? record.msg;
    if (typeof messageCandidate === 'string' && messageCandidate.trim()) {
      const detailCandidate = typeof record.details === 'string' ? ` ${record.details}` : '';
      const hintCandidate = typeof record.hint === 'string' ? ` ${record.hint}` : '';
      return translateAuthErrorMessage(`${messageCandidate.trim()}${detailCandidate}${hintCandidate}`);
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
const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
const shouldRetryStatus = (status: number) => status === 408 || status === 425 || status === 429 || status >= 500;

const buildRequestHeaders = async () => {
  const headers: Record<string, string> = {
    apikey: SUPABASE_PUBLIC_KEY,
    'Content-Type': 'application/json',
  };

  const sessionAccessToken =
    (await getValidStoredAuthSession())?.access_token ??
    readStoredAuthSession()?.access_token;

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
  const runAttempt = async (useTimeout: boolean) => {
    const controller = useTimeout ? new AbortController() : null;
    const timeoutId = useTimeout
      ? window.setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS)
      : null;

    try {
      return await fetch(url, {
        ...options,
        cache: 'no-store',
        signal: controller?.signal,
      });
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }
  };

  try {
    return await runAttempt(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    const isAbortError = error instanceof DOMException && error.name === 'AbortError';
    const isRetryableNetworkError =
      error instanceof TypeError ||
      /ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|Failed to fetch/i.test(message);

    if (isAbortError || !isRetryableNetworkError) {
      throw error;
    }

    console.warn('[cloudSync] retrying request after transient network/protocol failure', url, message);
    return runAttempt(false);
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
        headers: await buildRequestHeaders(),
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
        ...(await buildRequestHeaders()),
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

const normalizeCloudAppUser = (payload: unknown): CloudAppUser | null => {
  const record = asRecord(payload);
  if (!record || typeof record.username !== 'string' || typeof record.display_name !== 'string') {
    return null;
  }

  return {
    auth_user_id: typeof record.auth_user_id === 'string' ? record.auth_user_id : null,
    email: typeof record.email === 'string' ? record.email : null,
    username: record.username,
    display_name: record.display_name,
    role: typeof record.role === 'string' ? record.role : 'USER',
    avatar_url: typeof record.avatar_url === 'string' ? record.avatar_url : null,
    is_active: typeof record.is_active === 'boolean' ? record.is_active : undefined,
    last_login_at: typeof record.last_login_at === 'string' ? record.last_login_at : null,
    created_at: typeof record.created_at === 'string' ? record.created_at : undefined,
  };
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

const getValidStoredAuthSession = async (): Promise<SupabaseAuthSession | null> => {
  const storedSession = readStoredAuthSession();
  if (!storedSession?.access_token) {
    return null;
  }

  if (!isSessionExpired(storedSession)) {
    return storedSession;
  }

  if (!storedSession.refresh_token) {
    clearStoredAuthSession();
    return null;
  }

  const refreshedSession = await refreshAuthSession(storedSession.refresh_token);
  if (!refreshedSession?.access_token) {
    clearStoredAuthSession();
    return null;
  }

  persistAuthSession(refreshedSession);
  return refreshedSession;
};

export const restoreSupabaseAuthProfile = async (): Promise<CloudAuthProfile | null> => {
  if (!hasCloudConfig) {
    return null;
  }

  try {
    const storedSession = await getValidStoredAuthSession();
    if (!storedSession?.access_token) {
      return null;
    }

    const authUser = await fetchAuthUser(storedSession.access_token);
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
      ...storedSession,
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
    return { ok: false, message: 'Supabase nÃ£o estÃ¡ configurado.' };
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
        message: await parseAuthResponseError(response, 'NÃ£o foi possÃ­vel entrar com este e-mail e senha.'),
      };
    }

    const payload = (await response.json()) as unknown;
    const record = asRecord(payload);
    if (!record) {
      return { ok: false, message: 'Resposta invÃ¡lida do Supabase Auth.' };
    }

    const session: SupabaseAuthSession = {
      access_token: typeof record.access_token === 'string' ? record.access_token : undefined,
      refresh_token: typeof record.refresh_token === 'string' ? record.refresh_token : undefined,
      expires_at: typeof record.expires_at === 'number' ? record.expires_at : undefined,
      expires_in: typeof record.expires_in === 'number' ? record.expires_in : undefined,
      user: toSupabaseAuthUser(record.user),
    };

    if (!session.access_token || !session.user) {
      return { ok: false, message: 'SessÃ£o invÃ¡lida retornada pelo Supabase Auth.' };
    }

    const profile = buildAuthProfile(session.user);
    if (!profile) {
      return { ok: false, message: 'Perfil do usuÃ¡rio invÃ¡lido.' };
    }

    persistAuthSession(session);
    return { ok: true, profile };
  } catch {
    return { ok: false, message: 'Falha de conexÃ£o com o Supabase Auth.' };
  }
};

export const signUpWithSupabaseAuth = async (params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ ok: true; profile: CloudAuthProfile } | { ok: false; message: string }> => {
  if (!hasCloudConfig) {
    return { ok: false, message: 'Supabase nÃ£o estÃ¡ configurado.' };
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
        message: await parseAuthResponseError(response, 'NÃ£o foi possÃ­vel criar sua conta.'),
      };
    }

    const payload = (await response.json()) as unknown;
    const record = asRecord(payload);
    if (!record) {
      return { ok: false, message: 'Resposta invÃ¡lida do Supabase Auth.' };
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
          message: 'Conta criada. Seu projeto ainda exige confirmaÃ§Ã£o de e-mail. Em Supabase Auth, desative "Confirmar e-mail" e clique em "Salvar alteraÃ§Ãµes".',
        };
      }

      return {
        ok: false,
        message: 'Conta criada, mas nÃ£o foi possÃ­vel entrar automaticamente. Tente entrar manualmente com o mesmo e-mail e senha.',
      };
    }

    const profile = buildAuthProfile(session.user);
    if (!profile) {
      return { ok: false, message: 'Perfil do usuÃ¡rio invÃ¡lido.' };
    }

    persistAuthSession(session);
    return { ok: true, profile };
  } catch {
    return { ok: false, message: 'Falha de conexÃ£o com o Supabase Auth.' };
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
    return { ok: false, message: 'Supabase nÃ£o estÃ¡ configurado.' };
  }

  const session = await getValidStoredAuthSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return { ok: false, message: 'SessÃ£o invÃ¡lida. FaÃ§a login novamente.' };
  }

  try {

    const requestInit: RequestInit = {
      method: 'PUT',
      headers: {
        ...buildAuthBearerHeaders(accessToken),
        Accept: 'application/json',
      },
      body: JSON.stringify({
        password: newPassword,
      }),
    };

    let response: Response;
    try {
      response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, requestInit);
    } catch {
      response = await fetch(`${SUPABASE_URL}/auth/v1/user`, requestInit);
    }

    if (!response.ok) {
      return {
        ok: false,
        message: await parseAuthResponseError(response, 'NÃ£o foi possÃ­vel atualizar a senha.'),
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: 'Falha de conexÃ£o ao atualizar a senha. Se persistir, saia e entre novamente antes de tentar de novo.' };
  }
};

export const updateSupabaseAuthProfile = async (params: {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}): Promise<{ ok: true; profile: CloudAuthProfile } | { ok: false; message: string }> => {
  if (!hasCloudConfig) {
    return { ok: false, message: 'Supabase nÃ£o estÃ¡ configurado.' };
  }

  const session = await getValidStoredAuthSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return { ok: false, message: 'SessÃ£o invÃ¡lida. FaÃ§a login novamente.' };
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: buildAuthBearerHeaders(accessToken),
      body: JSON.stringify({
        data: {
          ...(typeof params.username === 'string' ? { username: params.username } : {}),
          ...(typeof params.displayName === 'string' ? { display_name: params.displayName } : {}),
          // Explicitly clear avatar_url from auth metadata; the app stores avatars in public.app_users.
          avatar_url: null,
        },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        message: await parseAuthResponseError(response, 'NÃ£o foi possÃ­vel atualizar o perfil.'),
      };
    }

    const payload = (await response.json()) as unknown;
    const updatedUser = toSupabaseAuthUser(payload);
    const profile = buildAuthProfile(updatedUser);
    if (!updatedUser || !profile) {
      return { ok: false, message: 'Perfil do usuÃ¡rio invÃ¡lido.' };
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
    return { ok: false, message: 'Falha de conexÃ£o ao atualizar o perfil.' };
  }
};

export const upsertCloudUser = async (payload: {
  authUserId: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}): Promise<CloudAppUser | null> => {
  if (!hasCloudConfig) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/upsert_app_user`, {
      method: 'POST',
      headers: await buildRequestHeaders(),
      body: JSON.stringify({
        p_auth_user_id: payload.authUserId,
        p_email: payload.email,
        p_username: payload.username,
        p_display_name: payload.displayName,
        p_avatar_url: payload.avatarUrl ?? null,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error('[cloudSync] upsertCloudUser failed', response.status, errorBody);
      return null;
    }

    return normalizeCloudAppUser(await response.json());
  } catch (error) {
    console.error('[cloudSync] upsertCloudUser failed: network/timeout', error);
    return null;
  }
};

export const listCloudUsers = async (): Promise<CloudAppUser[] | null> => {
  if (!hasCloudConfig) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/list_app_users`, {
      method: 'POST',
      headers: await buildRequestHeaders(),
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

export const getMyCloudUser = async (): Promise<CloudAppUser | null> => {
  if (!hasCloudConfig) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/get_my_app_user`, {
      method: 'POST',
      headers: await buildRequestHeaders(),
      body: '{}',
    });

    if (!response.ok) {
      return null;
    }

    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    return normalizeCloudAppUser(rows[0]);
  } catch {
    return null;
  }
};

export const listParticipantDirectory = async (): Promise<CloudParticipantUser[] | null> => {
  if (!hasCloudConfig) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/list_participant_directory`, {
      method: 'POST',
      headers: await buildRequestHeaders(),
      body: '{}',
    });

    if (!response.ok) {
      return null;
    }

    const rows = (await response.json()) as unknown;
    return Array.isArray(rows)
      ? rows
          .map(row => normalizeCloudAppUser(row))
          .filter((row): row is CloudAppUser => Boolean(row))
          .map(row => ({
            username: row.username,
            display_name: row.display_name,
            role: row.role,
            avatar_url: row.avatar_url,
            created_at: row.created_at,
          }))
      : null;
  } catch {
    return null;
  }
};

export const upsertCloudCompletion = async (payload: {
  peakId: string;
  completionId?: string;
  date: string;
  participants: string[];
  wikilocUrl?: string;
}): Promise<
  | {
      ok: true;
      completion: {
        id: string;
        date: string;
        participants: string[];
        ownerUserId?: string | null;
        wikilocUrl?: string;
      };
    }
  | {
      ok: false;
      message: string;
    }
> => {
  if (!hasCloudConfig) {
    return { ok: false, message: 'Supabase nÃ£o estÃ¡ configurado.' };
  }

  try {
    const validSession = await getValidStoredAuthSession();
    if (!validSession?.access_token) {
      return { ok: false, message: 'Sua sessÃ£o expirou. Entre novamente para salvar check-ins na nuvem.' };
    }

    const requestInit: RequestInit = {
      method: 'POST',
      headers: await buildRequestHeaders(),
      body: JSON.stringify({
        p_peak_id: payload.peakId,
        p_completion_id: payload.completionId ?? null,
        p_completion_date: payload.date,
        p_participants: payload.participants,
        p_wikiloc_url: payload.wikilocUrl ?? null,
      }),
    };

    const maxAttempts = 3;
    let response: Response | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        try {
          response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/upsert_completion`, requestInit);
        } catch {
          response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_completion`, requestInit);
        }
      } catch {
        if (attempt >= maxAttempts) {
          return { ok: false, message: 'Falha de conexÃƒÂ£o ao salvar a conquista.' };
        }

        await wait(attempt * 400);
        continue;
      }

      if (response.ok || !shouldRetryStatus(response.status) || attempt >= maxAttempts) {
        break;
      }

      await wait(attempt * 400);
    }

    if (!response) {
      return { ok: false, message: 'Falha de conexÃƒÂ£o ao salvar a conquista.' };
    }

    if (!response.ok) {
      return {
        ok: false,
        message: await parseAuthResponseError(response, 'NÃ£o foi possÃ­vel salvar a conquista.'),
      };
    }

    const record = asRecord(await response.json());
    if (!record || typeof record.id !== 'string' || typeof record.date !== 'string') {
      return { ok: false, message: 'Resposta invÃ¡lida ao salvar a conquista.' };
    }

    return {
      ok: true,
      completion: {
        id: record.id,
        date: record.date,
        participants: Array.isArray(record.participants)
          ? record.participants.filter((value): value is string => typeof value === 'string')
          : [],
        ownerUserId: typeof record.ownerUserId === 'string' ? record.ownerUserId : null,
        wikilocUrl: typeof record.wikilocUrl === 'string' ? record.wikilocUrl : undefined,
      },
    };
  } catch {
    return { ok: false, message: 'Falha de conexÃ£o ao salvar a conquista.' };
  }
};

export const deleteCloudCompletion = async (completionId: string): Promise<boolean> => {
  if (!hasCloudConfig) {
    return false;
  }

  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/delete_completion`, {
      method: 'POST',
      headers: await buildRequestHeaders(),
      body: JSON.stringify({
        p_completion_id: completionId,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
};
