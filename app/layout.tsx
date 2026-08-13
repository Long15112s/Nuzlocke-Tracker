import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nuzlink | Randomizer SoulLink Tracker",
  description: "Gemeinsamer Nuzlocke- und SoulLink-Tracker für Randomizer-Runs.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
