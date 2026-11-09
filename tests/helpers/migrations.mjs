export function migrationStatements(sql) {
  const triggers=[];
  const remaining=sql.replace(/CREATE TRIGGER\b[\s\S]*?\bEND;/gi,(trigger)=>{
    triggers.push(trigger);
    return "__TRIGGER_"+(triggers.length-1)+"__;";
  });
  return remaining.split(";").map((part)=>part.trim()).filter(Boolean).map((part)=>{
    const match=/^__TRIGGER_(\d+)__$/.exec(part);
    return match?triggers[Number(match[1])]:part;
  });
}
