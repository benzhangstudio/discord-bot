import type { DashboardGuild, DashboardUser, FeatureState } from "../../src/shared/features";

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
    channels: { id: string; name: string; type: number }[];
    roles: { id: string; name: string; color: string }[];
  };
  features: FeatureState[];
}

export const api = {
  config: () => request<{ clientId: string; botReady: boolean }>("/api/config"),
  me: () => request<DashboardUser>("/api/me"),
  guilds: () => request<DashboardGuild[]>("/api/guilds"),
  guild: (id: string) => request<GuildDetails>(`/api/guilds/${id}`),
  saveFeature: (guildId: string, featureId: string, state: Omit<FeatureState, "id">) =>
    request<FeatureState>(`/api/guilds/${guildId}/features/${featureId}`, { method: "PUT", body: JSON.stringify(state) }),
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
