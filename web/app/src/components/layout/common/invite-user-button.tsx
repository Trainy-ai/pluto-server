import { trpc } from "@/utils/trpc";
import React, { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import {
  UserPlus,
  Mail,
  Shield,
  Users,
  ShieldCheck,
  CheckCircle,
  PartyPopper,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Role = "ADMIN" | "MEMBER";
type FormStep = "form" | "success";

interface InviteUserProps extends ComponentProps<typeof Button> {
  className?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

export const InviteUser = ({
  className,
  variant,
  size = "default",
  ...buttonProps
}: InviteUserProps) => {
  const [formState, setFormState] = useState<{
    email: string;
    role: Role;
    isOpen: boolean;
    step: FormStep;
  }>({
    email: "",
    role: "MEMBER",
    isOpen: false,
    step: "form",
  });

  const { data: session } = useAuth();
  const orgId = session?.activeOrganization?.id;
  const userEmail = session?.user?.email;

  const orgQueryOptions = {
    organizationId: orgId || "",
  };

  const { data: members = [] } = useQuery({
    ...trpc.organization.listMembers.queryOptions(orgQueryOptions),
    enabled: !!orgId && formState.isOpen,
  });

  // Fetch pending invites - not strictly needed for seat count, but good to have context if needed later
  // const { data: pendingInvites = [] } = useQuery({
  //   ...trpc.organization.invite.listSentInvites.queryOptions(orgQueryOptions),
  //   enabled: !!orgId && formState.isOpen,
  // });

  const maxSeats =
    session?.activeOrganization?.OrganizationSubscription?.seats || 0;

  const createInvite = useMutation({
    ...trpc.organization.invite.createInvite.mutationOptions(),
    onSuccess: () => {
      toast.success("Invitation sent successfully", {
        description: `An invitation email has been sent to ${formState.email}`,
      });
      // Move to success step instead of closing
      setFormState((prev) => ({ ...prev, step: "success" }));
    },
    onError: (error) => {
      toast.error("Failed to send invitation", {
        description: error.message || "Please try again",
      });
    },
  });

  const handleDialogClose = (open: boolean) => {
    // Reset state completely when dialog is closed externally or finished
    if (!open) {
      setFormState({
        email: "",
        role: "MEMBER",
        isOpen: false,
        step: "form",
      });
    } else {
      setFormState((prev) => ({ ...prev, isOpen: true }));
    }
  };

  const handleResetAndClose = () => {
    handleDialogClose(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!orgId) {
      toast.error("Organization required", {
        description: "Please select an organization first",
      });
      return;
    }

    if (formState.email.toLowerCase() === userEmail?.toLowerCase()) {
      toast.error("Invalid invitation", {
        description: "You cannot invite yourself to the organization",
      });
      return;
    }

    const currentMemberCount = members.length;
    if (currentMemberCount >= maxSeats) {
      toast.error("Member limit reached", {
        description:
          "You've reached your organization's member limit. Please upgrade your plan to add more members.",
      });
      return;
    }

    createInvite.mutate({
      organizationId: orgId,
      email: formState.email,
      role: formState.role,
    });
  };

  if (!session || !orgId) {
    return null;
  }

  const currentMemberCount = members.length;
  const totalUsed = currentMemberCount; // Can add pendingInvites.length here if needed
  const usagePercentage = maxSeats > 0 ? (totalUsed / maxSeats) * 100 : 0;
  const isLimitReached = totalUsed >= maxSeats;

  return (
    <Dialog open={formState.isOpen} onOpenChange={handleDialogClose}>
      <DialogTrigger asChild>
        <Button
          className={cn(
            "gap-2",
            size === "icon" ? "w-8 px-0" : "min-w-[140px]",
            className,
          )}
          variant={variant}
          size={size}
          {...buttonProps}
        >
          <UserPlus className={cn("h-4 w-4", size === "lg" && "h-5 w-5")} />
          {size !== "icon" && "Invite User"}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        {formState.step === "form" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <UserPlus className="h-5 w-5 text-primary" />
                Invite Team Member
              </DialogTitle>
              <DialogDescription>
                Invite a new member to join your organization.
              </DialogDescription>
            </DialogHeader>

            <Separator className="my-4" />

            {/* Member limit indicator */}
            <Card className="mb-6 border-border/50 bg-muted/30">
              <CardHeader className="p-4">
                <CardTitle className="flex items-center justify-between text-base font-medium">
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Member Usage
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {totalUsed} of {maxSeats} seats used
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <Progress value={usagePercentage} className="h-2 w-full" />
                {isLimitReached && (
                  <Alert variant="destructive" className="mt-4">
                    <AlertTitle className="font-semibold">
                      Member limit reached
                    </AlertTitle>
                    <AlertDescription className="text-xs">
                      Upgrade your plan or remove members to invite more users.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Only show form inputs if limit is not reached */}
            {!isLimitReached && (
              <>
                {/* Beta Alert */}
                <Alert variant="info" className="mb-6">
                  <AlertTitle className="font-semibold">
                    Beta Feature
                  </AlertTitle>
                  <AlertDescription className="text-xs">
                    Permissions are not yet fully enforced during the beta
                    period.
                  </AlertDescription>
                </Alert>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="email"
                        className="flex items-center gap-2"
                      >
                        Email Address
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="colleague@company.com"
                        value={formState.email}
                        onChange={(e) =>
                          setFormState((prev) => ({
                            ...prev,
                            email: e.target.value,
                          }))
                        }
                        className="w-full"
                        required
                        disabled={isLimitReached || createInvite.isPending}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="role" className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-muted-foreground" />
                        Role & Permissions
                      </Label>
                      <Select
                        value={formState.role}
                        onValueChange={(value: Role) =>
                          setFormState((prev) => ({ ...prev, role: value }))
                        }
                        disabled={isLimitReached || createInvite.isPending}
                      >
                        <SelectTrigger id="role" className="w-full">
                          <SelectValue>
                            <div className="flex items-center gap-2">
                              {formState.role === "MEMBER" ? (
                                <Users className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span>
                                {formState.role === "MEMBER"
                                  ? "Member"
                                  : "Administrator"}
                              </span>
                            </div>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MEMBER" className="py-3">
                            <div className="flex items-start gap-3">
                              <Users className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                              <div className="flex flex-col gap-0.5">
                                <span className="font-medium">Member</span>
                                <span className="text-xs text-muted-foreground">
                                  Can view and interact with assigned resources.
                                </span>
                              </div>
                            </div>
                          </SelectItem>
                          <SelectItem value="ADMIN" className="py-3">
                            <div className="flex items-start gap-3">
                              <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                              <div className="flex flex-col gap-0.5">
                                <span className="font-medium">
                                  Administrator
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  Full access to all organization settings.
                                </span>
                              </div>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <DialogFooter className="mt-8">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={createInvite.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="gap-2"
                      disabled={
                        isLimitReached ||
                        createInvite.isPending ||
                        !formState.email // Basic validation
                      }
                    >
                      {createInvite.isPending ? (
                        <>
                          {/* <Loader2 className="mr-2 h-4 w-4 animate-spin" /> */}
                          Sending...
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" />
                          Send Invitation
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </>
            )}
          </>
        )}

        {formState.step === "success" && (
          <div className="flex flex-col items-center justify-center space-y-6 p-4 text-center">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-2xl font-semibold">
                Invitation Sent!{" "}
                <PartyPopper className="h-6 w-6 text-green-500" />
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                An invitation has been successfully sent to{" "}
                <span className="font-medium text-foreground">
                  {formState.email}
                </span>
              </DialogDescription>
            </DialogHeader>

            {/* Next Steps Section */}
            <div className="w-full rounded-md border border-border bg-background/50 p-4 text-left">
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                Next Steps
              </h4>
              <p className="text-xs text-muted-foreground">
                The invited user should sign up using the same email address (
                <span className="font-medium">{formState.email}</span>). Once
                registered, an invite will appear on their dashboard.
              </p>
            </div>

            <Button
              onClick={handleResetAndClose} // Use the reset function
              className="w-full"
            >
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
