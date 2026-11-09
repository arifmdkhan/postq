const names:Record<string,string>={facebook:"Facebook",instagram:"Instagram",threads:"Threads",youtube:"YouTube",tiktok:"TikTok",linkedin:"LinkedIn",pinterest:"Pinterest",twitter:"X"};
type NamedChannel={id:string;platform:string;label?:string|null;profile_name?:string|null;active?:number};
export function channelName(channel:NamedChannel){
  const platform=names[channel.platform]??channel.platform;
  const account=channel.label?.trim() || channel.profile_name?.trim();
  return (account?`${account} · ${platform}`:`${platform} account · ${channel.id.slice(-6)}`)+(channel.active===0?" · Removed":"");
}
export function channelOptions(channels:NamedChannel[]){
  const labels=channels.map(channelName);
  const counts=new Map<string,number>();for(const label of labels)counts.set(label,(counts.get(label)??0)+1);
  return channels.map((channel,index)=>({value:channel.id,label:(counts.get(labels[index])??0)>1?`${labels[index]} · ${channel.id.slice(-6)}`:labels[index]}));
}
