import { PlugZapIcon } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getLocalBridgeCommand,
  LOCAL_BRIDGE_DEFAULT_PORT,
} from "@/lib/local-bridge";
import type { UseLocalBridgeResult } from "@/hooks/use-local-bridge";
import { cn } from "@/lib/utils";

interface LocalAgentConnectProps {
  bridge: UseLocalBridgeResult;
}

export function LocalAgentConnect({ bridge }: LocalAgentConnectProps) {
  const [open, setOpen] = useState(false);
  const [port, setPort] = useState(
    String(bridge.settings?.port ?? LOCAL_BRIDGE_DEFAULT_PORT),
  );
  const [token, setToken] = useState(bridge.settings?.token ?? "");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || !token.trim()) {
      return;
    }
    bridge.saveSettings({ port: parsedPort, token: token.trim() });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <span
            className={cn(
              "mr-1.5 size-2 rounded-full",
              bridge.isConnected
                ? "bg-emerald-500"
                : bridge.settings
                  ? "bg-destructive"
                  : "bg-muted-foreground/40",
            )}
          />
          {bridge.isConnected
            ? `Local ${bridge.agentName ?? "agent"}`
            : "Connect agent"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Local agent bridge</h3>
            <p className="text-xs text-muted-foreground">
              Run{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {getLocalBridgeCommand(window.location.origin)}
              </code>{" "}
              on your machine, then enter the port and token it prints.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bridge-port">Port</Label>
            <Input
              id="bridge-port"
              inputMode="numeric"
              value={port}
              onChange={(event) => setPort(event.target.value)}
              placeholder={String(LOCAL_BRIDGE_DEFAULT_PORT)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bridge-token">Token</Label>
            <Input
              id="bridge-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Printed by the bridge on startup"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            {bridge.settings && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  bridge.saveSettings(null);
                  setToken("");
                  setOpen(false);
                }}
              >
                Disconnect
              </Button>
            )}
            <Button type="submit" size="sm" className="ml-auto">
              <PlugZapIcon className="mr-1 size-4" />
              Connect
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
