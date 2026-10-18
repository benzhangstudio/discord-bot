// Only messages deliberately written for users are shown directly in Discord.
export class UserError extends Error {constructor(message){super(message);this.name='UserError';}}
