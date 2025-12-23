import { SettingsLayout } from "@/components/layout/settings/layout";
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { trpc } from "@/utils/trpc";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Copy } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/o/$orgSlug/_authed/settings/org/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: session } = useAuth();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isFinalWarningOpen, setIsFinalWarningOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const organization = session?.activeOrganization;

  const deleteMutation = useMutation(
    trpc.organization.deleteOrg.mutationOptions({
      onSuccess: () => {
        toast.success("Organization deleted successfully");
        // Redirect to org selection page
        window.location.href = "/o";
      },
      onError: (error) => {
        toast.error("Failed to delete organization", {
          description: error.message || "Please try again",
        });
      },
    }),
  );

  if (!organization) {
    return null;
  }

  const userRole = organization.membership.role;

  const handleDelete = () => {
    if (deleteConfirmation !== organization.slug) {
      toast.error(
        "Please type the organization slug correctly to confirm deletion",
      );
      return;
    }

    setIsDeleteDialogOpen(false);
    setIsFinalWarningOpen(true);
    setDeleteConfirmation(""); // Reset confirmation for the next step
  };

  const handleFinalDelete = () => {
    if (deleteConfirmation !== `DELETE ${organization.slug}`) {
      toast.error(
        "Please type 'DELETE' followed by the organization slug to confirm final deletion",
      );
      return;
    }

    deleteMutation.mutate({ organizationId: organization.id });
    setIsFinalWarningOpen(false);
    setDeleteConfirmation(""); // Reset confirmation after deletion
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch (err) {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };

  return (
    <SettingsLayout>
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-4 p-4 sm:gap-8 sm:p-8">
        {/* Organization Details */}
        <Card>
          <CardHeader>
            <CardTitle>Organization Details</CardTitle>
            <CardDescription>
              View your organization's information
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid gap-2">
              <Label>Organization Name</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={organization.name}
                  className="mt-1 bg-muted font-mono"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() =>
                        copyToClipboard(organization.name, "Organization Name")
                      }
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy to clipboard</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Organization ID</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={organization.id}
                  className="mt-1 bg-muted font-mono"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() =>
                        copyToClipboard(organization.id, "Organization ID")
                      }
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy to clipboard</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Organization Slug</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={organization.slug}
                  className="mt-1 bg-muted font-mono"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() =>
                        copyToClipboard(organization.slug, "Organization slug")
                      }
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy to clipboard</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <Separator />
            <div className="grid gap-2">
              <Label>Organization Plan</Label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                  {organization.OrganizationSubscription.plan === "FREE" ? (
                    <>
                      <Badge>Free</Badge>
                      <span className="text-sm text-muted-foreground">
                        Limited features and usage
                      </span>
                      <Separator className="h-4" orientation="vertical" />
                      <span className="text-sm text-muted-foreground">
                        Contact founders@mlop.ai to upgrade
                      </span>
                    </>
                  ) : (
                    <>
                      <Badge>Pro</Badge>
                      <span className="text-sm text-muted-foreground">
                        Full access to all features
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        {userRole === "OWNER" && (
          <Card className="border-destructive/10 bg-destructive/5 dark:border-destructive/20">
            <CardHeader>
              <CardTitle className="text-destructive dark:text-destructive/90">
                Danger Zone
              </CardTitle>
              <CardDescription>
                Irreversible and destructive actions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog
                open={isDeleteDialogOpen}
                onOpenChange={setIsDeleteDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button variant="destructive">Delete Organization</Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]">
                  <DialogHeader className="space-y-4">
                    <DialogTitle className="flex items-center gap-2 text-destructive dark:text-destructive/90">
                      <AlertTriangle className="h-5 w-5" />
                      Delete Organization
                    </DialogTitle>
                    <DialogDescription className="text-base">
                      Are you sure you want to delete{" "}
                      <span className="font-medium text-foreground">
                        {organization.name}
                      </span>
                      ? This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-6">
                    <div className="rounded-lg border border-destructive/10 bg-destructive/5 p-4 text-sm text-destructive dark:border-destructive/20 dark:bg-destructive/20 dark:text-muted-foreground">
                      All organization data, including projects, resources, and
                      member access will be permanently deleted.
                    </div>
                    <div className="space-y-4">
                      <Label
                        htmlFor="confirmation"
                        className="text-sm text-muted-foreground"
                      >
                        Please type{" "}
                        <span className="font-mono font-medium text-foreground">
                          {organization.slug}
                        </span>{" "}
                        to confirm
                      </Label>
                      <Input
                        id="confirmation"
                        value={deleteConfirmation}
                        onChange={(e) => setDeleteConfirmation(e.target.value)}
                        placeholder="Enter organization slug"
                        className="mt-2"
                      />
                    </div>
                  </div>
                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setIsDeleteDialogOpen(false);
                        setDeleteConfirmation("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={deleteConfirmation !== organization.slug}
                    >
                      Continue
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Second Warning Dialog */}
              <Dialog
                open={isFinalWarningOpen}
                onOpenChange={setIsFinalWarningOpen}
              >
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]">
                  <DialogHeader className="space-y-4">
                    <DialogTitle className="flex items-center gap-2 text-destructive dark:text-destructive/90">
                      <AlertTriangle className="h-5 w-5" />
                      Second Confirmation Required
                    </DialogTitle>
                    <DialogDescription className="text-base">
                      Please confirm one more time that you want to delete{" "}
                      <span className="font-medium text-foreground">
                        {organization.name}
                      </span>
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-6">
                    <div className="rounded-lg border border-destructive/10 bg-destructive/5 p-4 text-sm text-destructive dark:border-destructive/20 dark:bg-destructive/20 dark:text-muted-foreground">
                      <div className="space-y-4">
                        <p className="font-medium">This action will:</p>
                        <ul className="list-disc space-y-2 pl-4">
                          <li>Permanently delete all organization data</li>
                          <li>Remove access for all team members</li>
                          <li>Delete all projects and their resources</li>
                          <li>Cancel any active subscriptions</li>
                        </ul>
                        <p className="pt-2 font-medium">
                          This action cannot be undone.
                        </p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <Label
                        htmlFor="finalConfirmation"
                        className="text-sm text-muted-foreground"
                      >
                        Please type{" "}
                        <span className="font-mono font-medium text-foreground">
                          DELETE {organization.slug}
                        </span>{" "}
                        to confirm
                      </Label>
                      <Input
                        id="finalConfirmation"
                        value={deleteConfirmation}
                        onChange={(e) => setDeleteConfirmation(e.target.value)}
                        placeholder="Enter DELETE followed by organization slug"
                        className="mt-2"
                      />
                    </div>
                  </div>
                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setIsFinalWarningOpen(false);
                        setDeleteConfirmation("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleFinalDelete}
                      disabled={
                        deleteConfirmation !== `DELETE ${organization.slug}`
                      }
                      className="gap-2"
                    >
                      <AlertTriangle className="h-4 w-4" />
                      Yes, Delete Organization
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        )}
      </div>
    </SettingsLayout>
  );
}
