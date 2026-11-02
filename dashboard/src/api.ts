import type {
  CategoryId,
  DashboardGuild,
  DashboardUser,
  FeatureState,
  ReactionRoleInput,
  ReactionRoleMessageView,
  SetupState,
} from "../../src/shared/features";
import type { OnboardingSettings, OnboardingStatus } from "../../src/shared/onboarding";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface GuildDetails {
  guild: {
    id: string;
    name: string;
    icon: string | null;
    memberCount: number;
    channels: { id: string; name: string; type: number; parentId: string | null }[];
    roles: { id: string; name: string; color: string; assignable: boolean }[];
    emojis: { id: string; name: string; animated: boolean; text: string }[];
  };
  features: FeatureState[];
  setup: SetupState;
}

export interface OnboardingResponse {
  settings: OnboardingSettings;
  status: OnboardingStatus;
  /** What "Set it up for me" will do, in plain words. */
  setupPlan: string[];
  /** Only the server owner can set up, change or turn off the access gate. */
  canManageAccess: boolean;
  warnings: string[];
}

export type ReactionRoleSaveResult = { message: ReactionRoleMessageView; warnings: string[] };

export const api = {
  config: () => request<{ clientId: string | null; loginReady: boolean; botReady: boolean }>("/api/config"),
  me: () => request<DashboardUser>("/api/me"),
  guilds: () => request<DashboardGuild[]>("/api/guilds"),
  guild: (id: string) => request<GuildDetails>(`/api/guilds/${id}`),
  saveFeature: (guildId: string, featureId: string, state: Omit<FeatureState, "id">) =>
    request<FeatureState>(`/api/guilds/${guildId}/features/${featureId}`, { method: "PUT", body: JSON.stringify(state) }),
  reactionRoles: (guildId: string) => request<ReactionRoleMessageView[]>(`/api/guilds/${guildId}/reaction-roles`),
  createReactionRole: (guildId: string, input: ReactionRoleInput) =>
    request<ReactionRoleSaveResult>(`/api/guilds/${guildId}/reaction-roles`, { method: "POST", body: JSON.stringify(input) }),
  updateReactionRole: (guildId: string, messageId: string, input: ReactionRoleInput) =>
    request<ReactionRoleSaveResult>(`/api/guilds/${guildId}/reaction-roles/${messageId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  saveSetup: (guildId: string, categories: CategoryId[]) =>
    request<{ turnedOn: string[]; setup: SetupState; features: FeatureState[] }>(`/api/guilds/${guildId}/setup`, {
      method: "PUT",
      body: JSON.stringify({ categories }),
    }),
  deleteReactionRole: (guildId: string, messageId: string) =>
    request<{ ok: true }>(`/api/guilds/${guildId}/reaction-roles/${messageId}`, { method: "DELETE" }),
  onboarding: (guildId: string) => request<OnboardingResponse>(`/api/guilds/${guildId}/onboarding`),
  saveOnboarding: (guildId: string, settings: OnboardingSettings) =>
    request<OnboardingResponse>(`/api/guilds/${guildId}/onboarding`, { method: "PUT", body: JSON.stringify(settings) }),
  setUpGate: (guildId: string) =>
    request<OnboardingResponse>(`/api/guilds/${guildId}/onboarding/gate/setup`, { method: "POST", body: "{}" }),
  removeGate: (guildId: string) =>
    request<OnboardingResponse>(`/api/guilds/${guildId}/onboarding/gate/remove`, { method: "POST", body: "{}" }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
};

export const guildIconUrl = (g: { id: string; icon: string | null }) =>
  g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null;

export const avatarUrl = (u: DashboardUser) =>
  u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null;

export const inviteUrl = (clientId: string, guildId?: string) => {
  const params = new URLSearchParams({ client_id: clientId, scope: "bot applications.commands", permissions: "8" });
  if (guildId) params.set("guild_id", guildId);
  return `https://discord.com/oauth2/authorize?${params}`;
};
