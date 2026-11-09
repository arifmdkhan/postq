import Link from "next/link";
import { BrandMark } from "./brand-mark";

export function Brand() {
  return (
    <Link href="/" className="inline-flex w-fit items-center gap-2 text-xl font-extrabold tracking-tight">
      <BrandMark className="size-8" /><span className="group-data-[collapsible=icon]:sr-only">PostQ</span><span className="sr-only"> home</span>
    </Link>
  );
}

