import { validTimezone } from "../publishing/timezone";

export async function readTimezonePreferences(db: D1Database, fallback?: string) {
  const {results}=await db.prepare("SELECT name,value FROM app_settings WHERE name IN ('display-timezone','display-timezone-mode')").all<{name:string;value:string}>();
  const values=Object.fromEntries(results.map(row=>[row.name,row.value]));
  const valid=validTimezone(values["display-timezone"]);
  const mode=values["display-timezone-mode"]==="auto"?"auto":values["display-timezone-mode"]==="manual" || valid && values["display-timezone"]!=="UTC"?"manual":"auto";
  const ready=valid && (mode==="manual" || values["display-timezone-mode"]==="auto");
  return {timezone:valid?values["display-timezone"]:validTimezone(fallback)?fallback:"UTC",mode,ready} as {timezone:string;mode:"auto"|"manual";ready:boolean};
}

export async function writeTimezonePreference(db:D1Database, timezone:string, mode:"auto"|"manual") {
  if(!validTimezone(timezone))throw new Error("Invalid timezone");
  await db.batch([
    db.prepare("INSERT INTO app_settings(name,value,updated_at) VALUES ('display-timezone-mode',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(mode,Date.now()),
    db.prepare("INSERT INTO app_settings(name,value,updated_at) VALUES ('display-timezone',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(timezone,Date.now()),
  ]);
}

export async function synchronizeLocalTimezone(db:D1Database, timezone:string) {
  if(!validTimezone(timezone))throw new Error("Could not detect a valid device timezone");
  const preferences=await readTimezonePreferences(db);
  if(preferences.mode==="manual")return {...preferences,changed:false};
  const results=await db.batch([
    db.prepare("INSERT INTO app_settings(name,value,updated_at) VALUES ('display-timezone-mode','auto',?) ON CONFLICT(name) DO UPDATE SET value='auto',updated_at=excluded.updated_at WHERE app_settings.value NOT IN ('auto','manual')").bind(Date.now()),
    db.prepare(`INSERT INTO app_settings(name,value,updated_at)
      SELECT 'display-timezone',?,? WHERE EXISTS (SELECT 1 FROM app_settings WHERE name='display-timezone-mode' AND value='auto')
      ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE app_settings.value<>excluded.value`).bind(timezone,Date.now()),
  ]);
  return {...await readTimezonePreferences(db),changed:results[1].meta.changes>0};
}
