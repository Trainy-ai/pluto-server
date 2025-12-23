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
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, Eye, EyeOff } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";

const SHOW_DANGER_ZONE = false;
const GETTING_STARTED_STORAGE_KEY = "getting-started-hidden";

export function AccountSettings() {
  const { data: auth } = useAuth();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isFinalWarningOpen, setIsFinalWarningOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isGettingStartedHidden, setIsGettingStartedHidden] = useState(true);

  const user = auth?.user;

  useEffect(() => {
    const hidden = localStorage.getItem(GETTING_STARTED_STORAGE_KEY);
    setIsGettingStartedHidden(hidden === "true");
  }, []);

  const toggleGettingStarted = () => {
    const newValue = !isGettingStartedHidden;
    setIsGettingStartedHidden(newValue);
    localStorage.setItem(GETTING_STARTED_STORAGE_KEY, String(newValue));
    toast.success(
      newValue
        ? "Getting started guide is now hidden"
        : "Getting started guide is now visible",
    );
  };

  if (!user) {
    return null;
  }

  const handleDelete = () => {
    if (deleteConfirmation !== user.email) {
      toast.error("Please type your email correctly to confirm deletion");
      return;
    }

    setIsDeleteDialogOpen(false);
    setIsFinalWarningOpen(true);
    setDeleteConfirmation(""); // Reset confirmation for the next step
  };

  const handleFinalDelete = () => {
    if (deleteConfirmation !== `DELETE ${user.email}`) {
      toast.error(
        "Please type 'DELETE' followed by your email to confirm final deletion",
      );
      return;
    }

    // Mock deletion - in reality this would call an API
    toast.success("This is a mock deletion - no actual deletion performed");
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
    <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-4 p-4 sm:gap-8 sm:p-8">
      {/* User Details */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>User Details</CardTitle>
          <CardDescription>View your account information</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-2">
            <Label>Name</Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={user.name}
                className="mt-1 bg-muted font-mono"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => copyToClipboard(user.name, "Name")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy to clipboard</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={user.email}
                className="mt-1 bg-muted font-mono"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => copyToClipboard(user.email, "Email")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy to clipboard</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>User ID</Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={user.id}
                className="mt-1 bg-muted font-mono"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => copyToClipboard(user.id, "User ID")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy to clipboard</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Getting Started Visibility */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>Configure your account settings</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>Getting Started Guide Visibility</Label>
              <p className="text-sm text-muted-foreground">
                {isGettingStartedHidden
                  ? "The getting started guide is currently hidden"
                  : "The getting started guide is currently visible"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="getting-started-visibility"
                checked={!isGettingStartedHidden}
                onCheckedChange={toggleGettingStarted}
              />
              <Label htmlFor="getting-started-visibility" className="text-sm">
                {!isGettingStartedHidden ? "Visible" : "Hidden"}
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      {SHOW_DANGER_ZONE && (
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
                <Button variant="destructive">Delete Account</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]">
                <DialogHeader className="space-y-4">
                  <DialogTitle className="flex items-center gap-2 text-destructive dark:text-destructive/90">
                    <AlertTriangle className="h-5 w-5" />
                    Delete Account
                  </DialogTitle>
                  <DialogDescription className="text-base">
                    Are you sure you want to delete your account? This action
                    cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-6">
                  <div className="rounded-lg border border-destructive/10 bg-destructive/5 p-4 text-sm text-destructive dark:border-destructive/20 dark:bg-destructive/20 dark:text-muted-foreground">
                    Your account data, including personal information and
                    preferences will be permanently deleted.
                  </div>
                  <div className="space-y-4">
                    <Label
                      htmlFor="confirmation"
                      className="text-sm text-muted-foreground"
                    >
                      Please type{" "}
                      <span className="font-mono font-medium text-foreground">
                        {user.email}
                      </span>{" "}
                      to confirm
                    </Label>
                    <Input
                      id="confirmation"
                      value={deleteConfirmation}
                      onChange={(e) => setDeleteConfirmation(e.target.value)}
                      placeholder="Enter your email"
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
                    disabled={deleteConfirmation !== user.email}
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
                    Please confirm one more time that you want to delete your
                    account
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-6">
                  <div className="rounded-lg border border-destructive/10 bg-destructive/5 p-4 text-sm text-destructive dark:border-destructive/20 dark:bg-destructive/20 dark:text-muted-foreground">
                    <div className="space-y-4">
                      <p className="font-medium">This action will:</p>
                      <ul className="list-disc space-y-2 pl-4">
                        <li>Permanently delete your account</li>
                        <li>Remove access to all organizations</li>
                        <li>Delete all your personal data</li>
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
                        DELETE {user.email}
                      </span>{" "}
                      to confirm
                    </Label>
                    <Input
                      id="finalConfirmation"
                      value={deleteConfirmation}
                      onChange={(e) => setDeleteConfirmation(e.target.value)}
                      placeholder="Enter DELETE followed by your email"
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
                    disabled={deleteConfirmation !== `DELETE ${user.email}`}
                    className="gap-2"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    Yes, Delete My Account
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
