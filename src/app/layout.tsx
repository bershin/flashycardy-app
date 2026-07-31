import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppChrome } from "@/components/app-chrome";
import "./globals.css";

const poppins = Poppins({
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FlashyCardy",
  description: "Personal flashcard study app",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FlashyCardy",
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
      className={`${poppins.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <TooltipProvider>
          {/* Boots the local database and the sync loop, and renders the header. */}
          <AppChrome />
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
