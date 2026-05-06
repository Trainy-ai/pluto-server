import { createFileRoute } from "@tanstack/react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsLayout } from "@/components/layout/settings/layout";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useFpsMonitorEnabled } from "@/lib/hooks/use-fps-monitor-enabled";

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/settings/account/preferences",
)({
  component: RouteComponent,
});

function RouteComponent() {
  useDocumentTitle("Preferences");
  const { enabled, setEnabled } = useFpsMonitorEnabled();

  return (
    <SettingsLayout>
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-4 p-4 sm:gap-8 sm:p-8">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Performance</CardTitle>
            <CardDescription>
              Diagnostic overlays for measuring UI performance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Frame rate monitor</Label>
                <p className="text-sm text-muted-foreground">
                  Show a small FPS overlay in the corner of the screen. Useful
                  for diagnosing chart and UI performance.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="fps-monitor"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
                <Label htmlFor="fps-monitor" className="text-sm">
                  {enabled ? "On" : "Off"}
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </SettingsLayout>
  );
}
