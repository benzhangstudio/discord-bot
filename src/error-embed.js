// One consistent, neutral embed for every public error and validation message.
export const ERROR_COLOR=0x4F545C;
const TITLES=[
 [/could not confirm|check the result before/i,'Result not confirmed'],
 [/permission|only the|not allowed|cannot moderate|can’t moderate|protected|must be above|access|don’t have/i,'Not allowed'],
 [/took too long|did not respond|try again later|something went wrong|could not be (reached|delivered|saved)|unavailable/i,'Couldn’t complete that'],
 [/not found|no longer available|no appeal found|not valid/i,'Not found'],
];
export function errorTitle(message){for(const [re,t]of TITLES)if(re.test(message))return t;return 'Check your input';}
export function errorEmbed(message,{title,fields}={}){
 const text=String(message||'Something went wrong. Try again later.');
 return {color:ERROR_COLOR,title:title||errorTitle(text),description:text.slice(0,4000),...(fields?.length?{fields}:{})};
}
export const errorPayload=(message,opts)=>({content:'',embeds:[errorEmbed(message,opts)],components:[],allowedMentions:{parse:[]}});
