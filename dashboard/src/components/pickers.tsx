import type { GuildDetails } from "../api";

type Guild = GuildDetails["guild"];

const TEXT_CHANNEL_TYPES = new Set([0, 5]); // text and announcement channels

/** Dropdown of the server's text channels. `emptyLabel` adds a "none" choice. */
export function ChannelSelect({
  guild,
  value,
  onChange,
  emptyLabel,
}: {
  guild: Guild;
  value: string | null;
  onChange: (id: string | null) => void;
  emptyLabel?: string;
}) {
  const channels = guild.channels.filter((c) => TEXT_CHANNEL_TYPES.has(c.type));
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {!emptyLabel && !value && <option value="">Choose a channel…</option>}
      {channels.map((c) => (
        <option key={c.id} value={c.id}>
          #{c.name}
        </option>
      ))}
    </select>
  );
}

/** Pick several roles: chosen ones show as removable chips. Roles above the bot are greyed out. */
export function RolePicker({
  guild,
  value,
  onChange,
  max = 10,
  placeholder = "Add a role…",
}: {
  guild: Guild;
  value: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  placeholder?: string;
}) {
  const roleOf = (id: string) => guild.roles.find((r) => r.id === id);
  const available = guild.roles.filter((r) => !value.includes(r.id));
  return (
    <div className="role-picker">
      {value.map((id) => {
        const role = roleOf(id);
        const color = role && role.color !== "#000000" ? role.color : undefined;
        return (
          <span key={id} className="chip" style={color ? { borderColor: color } : undefined}>
            <span style={color ? { color } : undefined}>@{role?.name ?? "deleted role"}</span>
            <button type="button" aria-label="Remove role" onClick={() => onChange(value.filter((x) => x !== id))}>
              ×
            </button>
          </span>
        );
      })}
      {value.length < max && (
        <select
          className="chip-add"
          value=""
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
        >
          <option value="">{placeholder}</option>
          {available.map((r) => (
            <option key={r.id} value={r.id} disabled={!r.assignable}>
              @{r.name}
              {r.assignable ? "" : " (above my role)"}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Single role dropdown. */
export function RoleSelect({
  guild,
  value,
  onChange,
  emptyLabel = "Choose a role…",
}: {
  guild: Guild;
  value: string | null;
  onChange: (id: string | null) => void;
  emptyLabel?: string;
}) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {guild.roles.map((r) => (
        <option key={r.id} value={r.id} disabled={!r.assignable}>
          @{r.name}
          {r.assignable ? "" : " (above my role)"}
        </option>
      ))}
    </select>
  );
}

/** On/off switch with a label, used for every optional part of a feature. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {hint && <small className="muted">{hint}</small>}
      </span>
      <button
        type="button"
        className={`switch ${checked ? "on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </label>
  );
}
