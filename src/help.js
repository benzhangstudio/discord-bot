import {EmbedBuilder} from 'discord.js';
import {DateTime} from 'luxon';
const categories=[
  ['home','Getting started','Meet Number One and find your way around','👋'],
  ['embeds','Announcements & embeds','Create and share a styled message','💌'],
  ['events','Events & schedules','Find events, RSVP, or plan something new','📅'],
  ['feeds','Weekly posts','Follow new posts in a weekly roundup','📰'],
  ['setup','Server settings','Choose a timezone and who can manage things','⚙️']
];
export function helpMenu({page='home',canManage=false,canConfigure=false,timezone='America/New_York'}={}) {
  if(!categories.some(([value])=>value===page))throw Error('That help page is no longer available. Open /help again.');
  const example=DateTime.now().setZone(timezone).plus({days:1}).set({hour:19,minute:0}).toFormat("yyyy-MM-dd'T'HH:mm");
  const pages={
    home:{title:'Welcome to Number One 👋',description:'A little help keeping your community connected. Choose a topic from the menu below.',fields:[
      {name:'📅 See what’s coming up',value:'Find upcoming events, check the details, and let everyone know if you’re going.'},
      {name:'💌 Make an announcement',value:canManage?'Build a styled message, preview it, and share it in a channel.':'Your server’s staff can create and share styled announcements.'},
      {name:'📰 Catch up on new posts',value:'Follow the weekly roundup in your server’s chosen channel.'},
      {name:'Need a hand?',value:'Choose a topic below for a short walkthrough. You can open /help anytime.'}
    ]},
    embeds:{title:'💌 Announcements & embeds',description:'Give your announcements a little personality with styled text, pictures, links, and colors.',fields:canManage?[
      {name:'1 · Start a message',value:'Use **/embed create** and give it a name, such as “Welcome” or “Weekly news”.'},
      {name:'2 · Make it yours',value:'Use the builder controls to edit the text and color, add pictures, arrange information in fields, or add an author and footer. Your changes save automatically.'},
      {name:'3 · Preview and share',value:'Use **/embed send** to choose your saved message and the channel. You can also choose a person or role to notify.'},
      {name:'Come back later',value:'**/embed list** shows your saved messages and their IDs. Copy an ID into **/embed edit** to keep working, or **/embed delete** to remove the saved message.'},
      {name:'Channel links & notifications',value:'You can include channel mentions in your text. To actually notify someone, choose the person or role when sending; mentions inside the embed do not send a notification.'}
    ]:[{name:'Want to share an announcement?',value:'Ask a staff member to create one. Building and publishing announcements is available to the people who manage Number One in your server.'}]},
    events:{title:'📅 Events & schedules',description:'Keep up with community events, meetings, and who’s on duty.',fields:[
      {name:'Find your next event',value:'Use **/schedule list** to see upcoming events. Copy an event’s ID into **/schedule show** for its time, location, and details.'},
      {name:'Let people know you’re coming',value:'Choose **Going**, **Maybe**, or **Decline** on an event card. You can change your answer later. Open **/schedule show** again to see the latest totals.'},
      ...(canManage?[
        {name:'Plan an event',value:`Use **/schedule add**. Choose a title, start time, and channel. For the start, use a date and time like **${example}**. The server timezone is **${timezone}**.`},
        {name:'Make it recurring',value:'Choose daily or weekly repetition for regular events. For staff rotations, choose “rotation” and provide the people in the order they should take turns. Staff meetings and rotations need a staff-only channel.'},
        {name:'Remind, share, or change plans',value:'Choose how many minutes before the event to send its reminder; use 0 for a message at the start. Use **/schedule post** to share an event card, **edit** to update details, **configure** to change reminders or repetition, and **cancel** to cancel future occurrences.'}
      ]:[]),
      {name:'Private meetings stay private',value:'You’ll only see events in channels you can access. Discord displays event timestamps in your own local time.'}
    ]},
    feeds:{title:'📰 Weekly posts',description:'New posts are gathered into one weekly roundup, rather than sending a message for every update.',fields:[
      {name:'When does it arrive?',value:'**Sunday at 12:00 a.m. in America/New_York**—the beginning of Sunday. If there are no new posts, no message is sent.'},
      ...(canManage?[
        {name:'Choose where posts go',value:'Use **/feed add** with a name, a supported RSS/Atom feed link, and your chosen channel. You can optionally notify a role when the roundup arrives.'},
        {name:'Check or manage a feed',value:'**/feed list** shows saved feeds, their IDs, and how many posts are waiting. Use an ID with **/feed preview** to peek at the latest post, **pause** or **resume** to control delivery, or **remove** to unsubscribe.'},
        {name:'Following Instagram?',value:'Ask the bot owner for a supported feed link. An Instagram profile link alone won’t work. Story coverage depends on the feed provider.'}
      ]:[{name:'Want a feed added?',value:'Ask your server’s staff to choose a source and a channel for the weekly roundup. Instagram story coverage depends on the source.'}])
    ]},
    setup:{title:'⚙️ Server settings',description:canConfigure?'A few choices to make Number One fit your server.':'These settings are managed by your server’s administrators.',fields:canConfigure?[
      {name:'Set your timezone',value:`Use **/settings timezone** to choose your server’s timezone, such as **America/New_York** or **Asia/Seoul**. Right now it’s **${timezone}**. Existing events keep their original timezone; weekly roundups always use New York time.`},
      {name:'Choose who can help',value:'Use **/settings staff** to choose a role that can manage announcements, schedules, and feeds. **/settings clear-staff** removes that extra access. Members with Manage Server permission can always manage Number One.'},
      {name:'Review your settings',value:'**/settings view** shows the current choices. **/settings status** checks for delivery problems. If something goes wrong, share the error reference with the bot owner.'}
    ]:[{name:'Need something changed?',value:'Ask someone with Manage Server permission to choose the timezone or staff role. You can still browse events and RSVP without managing the bot.'}]}
  };
  const selected=pages[page];
  return {content:'',embeds:[new EmbedBuilder().setColor(0xe5a1b3).setTitle(selected.title).setDescription(selected.description).addFields(selected.fields).setFooter({text:'Number One • Only you can see this help menu'})],components:[{type:1,components:[{type:3,custom_id:'help:topic',placeholder:'What would you like help with?',min_values:1,max_values:1,options:categories.map(([value,label,description,emoji])=>({value,label,description,emoji:{name:emoji},default:value===page}))}]}],allowedMentions:{parse:[]}};
}
