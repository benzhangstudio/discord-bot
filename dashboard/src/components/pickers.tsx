import type { GuildDetails } from "../api";
import { type SearchOption, SearchSelect } from "./SearchSelect";

type Guild = GuildDetails["guild"];

const TEXT_CHANNEL_TYPES = new Set([0, 5]); // text and announcement channels

const roleColor = (color: string) => (color !== "#000000" ? color : undefined);

/** The server's roles as search options. Roles above the bot are greyed out. */
export function roleOptions(guild: Guild, exclude: string[] = [], anyRole = false): SearchOption[] {
  return guild.roles
    .filter((r) => !exclude.includes(r.id))
    .map((r) => ({
      value: r.id,
      label: r.name,
      prefix: "@",
      color: roleColor(r.color),
      disabled: !anyRole && !r.assignable,
      note: anyRole || r.assignable ? undefined : "above my role",
    }));
}

/** Searchable dropdown of the server's text channels. `emptyLabel` adds a "none" choice. */
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
  const options = guild.channels
    .filter((c) => TEXT_CHANNEL_TYPES.has(c.type))
    .map((c) => ({ value: c.id, label: c.name, prefix: "#" }));
  return (
    <SearchSelect
      options={options}
      value={value}
      onChange={onChange}
      emptyLabel={emptyLabel}
      placeholder="Choose a channel…"
      searchPlaceholder="Search channels…"
    />
  );
}

/** Pick several roles: chosen ones show as removable chips, plus a searchable "Add a role…" button. */
export function RolePicker({
  guild,
  value,
  onChange,
  max = 10,
  placeholder = "Add a role…",
  anyRole = false,
}: {
  guild: Guild;
  value: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  placeholder?: string;
  /** Allow every role, even ones above the bot (for "who can use this" lists, where nothing is handed out). */
  anyRole?: boolean;
}) {
  const roleOf = (id: string) => guild.roles.find((r) => r.id === id);
  return (
    <div className="role-picker">
      {value.map((id) => {
        const role = roleOf(id);
        const color = role ? roleColor(role.color) : undefined;
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
        <SearchSelect
          className="chip-add"
          options={roleOptions(guild, value, anyRole)}
          value={null}
          onChange={(id) => id && onChange([...value, id])}
          searchPlaceholder="Search roles…"
          trigger={<span>+ {placeholder.replace(/…$/, "")}</span>}
        />
      )}
    </div>
  );
}

/** Searchable single role dropdown. */
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
    <SearchSelect
      options={roleOptions(guild)}
      value={value}
      onChange={onChange}
      placeholder={emptyLabel}
      searchPlaceholder="Search roles…"
    />
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
