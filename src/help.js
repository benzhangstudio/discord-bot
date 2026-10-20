import {UserError} from './user-error.js';
import {EmbedBuilder} from 'discord.js';
import {DateTime} from 'luxon';
import {timezoneLabel} from './suggestions.js';
const categories=[
  ['home','Getting started','Meet Number One and find your way around','👋'],
  ['embeds','Announcements & embeds','Create and share a styled message','💌'],
  ['events','Events & schedules','Find events, RSVP, or plan something new','📅'],
  ['feeds','Instagram','Follow new Instagram posts in scheduled roundups','📰'],
  ['setup','Server settings','Choose a timezone and who can manage things','⚙️']
];
export function helpMenu({page='home',canManage=false,canConfigure=false,timezone='America/New_York'}={}) {
  if(!categories.some(([value])=>value===page))throw new UserError('That help page is no longer available. Open /help again.');
  const example=DateTime.now().setZone(timezone).plus({days:1}).set({hour:19,minute:0}).toFormat('yyyy-MM-dd HH:mm');
  const pages={
    home:{title:'Welcome to Number One 👋',description:'A little help keeping your community connected. Choose a topic from the menu below.',fields:[
      {name:'📅 See what’s coming up',value:'Find upcoming events, check the details, and let everyone know if you’re going.'},
      {name:'💌 Make an announcement',value:canManage?'Build a styled message, preview it, and share it in a channel.':'Your server’s staff can create and share styled announcements.'},
      {name:'📰 Catch up on new posts',value:'Catch up on Instagram posts in your server’s chosen channel.'},
      {name:'Need a hand?',value:'Choose a topic below for a short walkthrough. You can open /help anytime.'}
    ]},
    embeds:{title:'💌 Announcements & embeds',description:'Give your announcements a little personality with styled text, pictures, links, and colors.',fields:canManage?[
      {name:'1 · Start a message',value:'Use **/embed create** and give your draft a name. A form opens for its saved name, title, main text, color, and optional message. Submit it to see your private preview.'},
      {name:'2 · Make it yours',value:'**Edit form** changes the main details together. Use the other controls for pictures, sections, and author details. Changes save automatically. **Save & close** keeps your work for later; **Make a copy** starts an independent version.'},
      {name:'3 · Preview and share',value:'Choose a channel and optional role/person notifications below the preview, then **Publish**. You can also use **/embed send**. Publishing keeps your saved draft so you can reuse it.'},
      {name:'Come back later',value:'**/embed list** shows your saved messages. With **/embed edit**, start typing the message’s name and choose a suggestion. **/embed delete** removes the saved message; copies already posted stay in their channels.'},
      {name:'Channel links & notifications',value:'You can include channel mentions in your text. To actually notify someone, choose the person or role when sending; mentions inside the embed do not send a notification.'}
    ]:[{name:'Want to share an announcement?',value:'Ask a staff member to create one. Building and publishing announcements is available to the people who manage Number One in your server.'}]},
    events:{title:'📅 Events & schedules',description:'Keep up with community events, meetings, and who’s on duty.',fields:[
      {name:'Find your next event',value:'Use **/schedule list** to see upcoming events. With **/schedule show**, start typing an event’s name and choose a suggestion for its time, location, and details.'},
      {name:'Let people know you’re coming',value:'Choose **Going**, **Maybe**, or **Can’t make it** on an event card. You can change your answer later. Open **/schedule show** again to see the latest replies.'},
      ...(canManage?[
        {name:'Plan an event',value:`Use **/schedule add**. Choose a title, start time, and channel. Use a date and time like **${example}**, using a 24-hour clock. New events use **${timezoneLabel(timezone)}**; choose a different city in the zone option if needed.`},
        {name:'Make it recurring',value:'Choose daily or weekly repetition for regular events. For staff rotations, choose “rotation” and provide the people in the order they should take turns. Staff meetings and rotations need a staff-only channel.'},
        {name:'Remind, share, or change plans',value:'Choose how many minutes before the event to send its reminder; use 0 for a message at the start. Use **/schedule post** to share a card, **edit** for details, **configure** for reminders or repetition, and **cancel** to stop the event and its future reminders.'}
      ]:[]),
      {name:'Private meetings stay private',value:'You’ll only see events in channels you can access. Discord shows event times in your own local time.'}
    ]},
    feeds:{title:'📸 Instagram',description:'Catch up on new posts with a daily or weekly roundup tailored to your server.',fields:[
      {name:'When does it arrive?',value:'Your server’s staff choose the delivery day, time, and timezone. Empty roundups are skipped. Discord shows the next delivery in your own local time.'},
      ...(canManage?[
        {name:'Set it up in one menu',value:'Open **/instagram setup**. Choose **Source** to add a name and an RSS/Atom link from an Instagram feed service. Pick a channel, an optional role to notify, and daily or weekly delivery. **Schedule** lets you choose the time, timezone, weekly day, and link previews. Choose **Save** when ready. No bot-owner approval is needed.'},
        {name:'Preview or change settings',value:'Use **Preview** before saving. To edit a source later, open **/instagram setup** and choose it from the top menu. Waiting posts are preserved when you change delivery settings.'},
        {name:'Manage your sources',value:'**/instagram list** shows your sources and waiting posts. Choose a source by name with **/instagram preview**, **pause**, **resume**, or **remove**. Pausing stops both collection and delivery.'},
        {name:'Which link do I need?',value:'Use the RSS/Atom link supplied by your Instagram feed service. An Instagram profile link alone will not work. Posts and stories depend on that service’s coverage. Existing posts are not resent when you add a source.'}
      ]:[{name:'Want Instagram posts in your server?',value:'Ask your server’s staff to open /instagram setup. They can choose a source, channel, delivery time, and timezone without contacting the bot owner.'}])
    ]},
    setup:{title:'⚙️ Server settings',description:canConfigure?'A few choices to make Number One fit your server.':'These settings are managed by your server’s administrators.',fields:canConfigure?[
      {name:'Set your timezone',value:`Use **/settings timezone**, type a city such as **New York** or **Seoul**, and choose a suggestion. Right now new events use **${timezoneLabel(timezone)}**. Existing events and Instagram sources keep their own timezone. Instagram delivery has its own schedule in /instagram setup.`},
      {name:'Who can use commands?',value:'Every slash command requires **Administrator** or **Manage Server** permission. A custom staff role alone does not grant access.'},
      {name:'Review your settings',value:'**/settings view** shows the current choices. **/settings status** checks for delivery problems. If something goes wrong, share the error reference with the bot owner.'}
    ]:[{name:'Need something changed?',value:'Ask someone with Manage Server permission to choose the timezone or staff role. You can still browse events and RSVP without managing the bot.'}]}
  };
  const selected=pages[page];
  return {content:'',embeds:[new EmbedBuilder().setColor(0xe5a1b3).setTitle(selected.title).setDescription(selected.description).addFields(selected.fields).setFooter({text:'Number One • Choose a topic from the menu below'})],components:[{type:1,components:[{type:3,custom_id:'help:topic',placeholder:'What would you like help with?',min_values:1,max_values:1,options:categories.map(([value,label,description,emoji])=>({value,label,description,emoji:{name:emoji},default:value===page}))}]}],allowedMentions:{parse:[]}};
}
