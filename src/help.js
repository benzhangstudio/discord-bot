import {EmbedBuilder} from 'discord.js';
import {commands} from './commands.js';
import {UserError} from './user-error.js';

// Every registered command belongs to exactly one category (enforced by tests).
// Command lines are generated from the registered definitions so help stays in sync.
export const categories=[
  {value:'mod',label:'Moderation',description:'Warn, timeout, kick, ban and case history',commands:['warn','unwarn','timeout','untimeout','kick','ban','unban','purge','case'],note:'**Images:** add optional `image`, `image2`, `image3` or `message-link` inputs to the same command. Images are never sent in member DMs.\n**History:** `/case user:@member` lists all moderation records, 10 per page. Use `page` for older records.\n**Remove a warning:** `/unwarn user:@member warning:12` uses the short Case #12 shown in that member’s history.\n**Update a case:** `/case number:12 reason:... image:...`; omit note and image to view it. Only the owner or an administrator can supply `outcome` after checking Discord.\n**DMs:** set `dm:false` to skip the member notice.\n**Mod log:** set up recording on the dashboard: {dashboard}'},
  {value:'lockdown',label:'Lockdown',description:'Lock and unlock channels',commands:['lockdown']},
  {value:'embeds',label:'Embeds',description:'Create, edit and send embed messages',commands:['embed']},
  {value:'events',label:'Scheduler',description:'Events, meetings, reminders and rotations',commands:['schedule']},
  {value:'feeds',label:'Instagram',description:'Instagram feed sources and roundups',commands:['instagram']},
  {value:'portal',label:'Dashboard',description:'Web dashboard, moderation settings and command access',commands:['dashboard']},
  {value:'setup',label:'Settings',description:'Settings overview, timezone, delivery status and help',commands:['settings','help']},
];
const plain=text=>String(text||'').trim().replace(/\.$/,'');
export function commandLines(names) {
  return names.map(name=>commands.find(c=>c.name===name)).filter(Boolean).flatMap(c=>{
    const subs=c.options?.filter(o=>o.type===1)||[];
    return subs.length?subs.map(s=>`\`/${c.name} ${s.name}\` – ${plain(s.description)}`):[`\`/${c.name}\` – ${plain(c.description)}`];
  });
}
const FOOTER='Commands require the matching Discord permissions.';
const dashboardLink=guildId=>{const origin=process.env.AGE_ORIGIN||'https://number-one.wispbyte.app';try{const u=new URL(origin);if(u.protocol==='https:'&&u.origin===origin)return new URL(guildId?`/dashboard/${encodeURIComponent(guildId)}/moderation`:'/dashboard',u).href;}catch{}return 'use /dashboard';};
export function helpMenu({page='home',guildId}={}) {
  const topic=page==='home'?null:categories.find(c=>c.value===page);
  if(page!=='home'&&!topic)throw new UserError('Open /help for the current command menu.');
  const embed=new EmbedBuilder().setColor(0x5865f2).setFooter({text:FOOTER});
  if(!topic)embed.setTitle('Help').setDescription(['Select a category to see its commands.','',...categories.map(c=>`**${c.label}** – ${c.description}`)].join('\n'));
  else embed.setTitle(topic.label).setDescription([...commandLines(topic.commands),...(topic.note?['',topic.note.replace('{dashboard}',dashboardLink(guildId))]:[])].join('\n').slice(0,4000));
  return {content:'',embeds:[embed],components:[
    {type:1,components:[{type:3,custom_id:'help:topic',placeholder:'Select a category',min_values:1,max_values:1,
      options:[{value:'home',label:'Overview',description:'All categories',default:page==='home'},...categories.map(c=>({value:c.value,label:c.label,description:c.description.slice(0,100),default:c.value===page}))]}]}
  ],allowedMentions:{parse:[]}};
}
