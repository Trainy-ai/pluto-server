import React from "react";
import { ThemeSwitcher } from "./theme-switcher";

interface FooterProps {
  className?: string;
}

export function Footer({ className = "" }: FooterProps) {
  return (
    <footer className={`fixed inset-x-0 bottom-0 z-10 ${className}`}>
      <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-center gap-8 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <span className="font-medium">
            © {new Date().getFullYear()} trainy.ai
          </span>
          <span className="text-xs">
            Powered by{" "}
            <a
              href="https://github.com/Trainy-ai/pluto"
              className="transition-colors hover:text-foreground hover:underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              Trainy's fork of MLOP - 🪐 Pluto
            </a>
          </span>
          <div className="flex items-center gap-4">
            <a
              href="https://trainy.ai/terms-of-use"
              className="transition-colors hover:text-foreground"
              rel="noopener noreferrer"
              target="_blank"
            >
              Terms
            </a>
            <a
              href="https://trainy.ai/privacy-policy"
              className="transition-colors hover:text-foreground"
              rel="noopener noreferrer"
              target="_blank"
            >
              Privacy
            </a>
          </div>
        </div>
        <ThemeSwitcher />
      </div>
    </footer>
  );
}
