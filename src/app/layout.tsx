import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppChrome } from "@/components/app-chrome";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const poppins = Poppins({
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cue",
  description: "Personal flashcard study app",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Cue",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Stamps the theme before first paint — see THEME_INIT_SCRIPT. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/*
        The window is the frame, not the floor: `h-full` with the scrolling
        moved inside means a page that wants to fill the screen actually can.
        Under `min-h-full` the body grew to whatever it held, so a screen asking
        for the height it had been given was handed the height of its own
        contents — which is how the study card ran off the bottom instead of
        scrolling within itself.
      */}
      <body
        className="flex h-full flex-col overflow-hidden"
        suppressHydrationWarning
      >
        <TooltipProvider>
          {/* Boots the local database and the sync loop, and renders the header. */}
          <AppChrome />
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </main>
        </TooltipProvider>
      </body>
    </html>
  );
}
