import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { OfflineRegistration } from "@/components/offline-registration";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PostQ",
  description: "A social studio of your own.",
  applicationName: "PostQ",
  icons: { icon: [{url:"/postq.svg",type:"image/svg+xml",sizes:"any"}], shortcut:"/favicon.ico", apple:[{url:"/apple-icon.png",sizes:"180x180",type:"image/png"}] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
     <>
      <html lang="en" suppressHydrationWarning>
        <head />
        <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider>{children}</TooltipProvider>
            <OfflineRegistration />
          </ThemeProvider>
        </body>
      </html>
    </>
  );
}
