import Image from "next/image";
import { cn } from "cn";

export function BrandMark({className=""}:{className?:string}) {
  return <Image src="/postq.svg" width={64} height={64} alt="" aria-hidden="true" unoptimized className={cn("size-9 shrink-0",className)} />;
}
