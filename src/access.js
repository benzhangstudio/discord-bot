export function isServerOwner(i) {
  return Boolean(i.guild?.ownerId && i.user?.id===i.guild.ownerId);
}
