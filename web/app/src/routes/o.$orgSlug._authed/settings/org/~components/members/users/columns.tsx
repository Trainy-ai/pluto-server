import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type ColumnDef } from "@tanstack/react-table";
import {
  MoreHorizontal,
  Trash2,
  Info,
  Shield,
  UserCog,
  User,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type OrganizationRole = "OWNER" | "ADMIN" | "MEMBER";

type Member = inferOutput<typeof trpc.organization.listMembers>[0];

const formatDate = (date: Date | null) => {
  if (!date) return "Never";
  const locale = navigator.language;
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Text copied to clipboard");
  } catch (err) {
    toast.error("Failed to copy to clipboard");
  }
};

function RoleBadge({ role }: { role: OrganizationRole }) {
  const roleConfig: Record<
    OrganizationRole,
    { icon: React.ReactNode; className: string; description: string }
  > = {
    OWNER: {
      icon: <Shield className="mr-1 h-3 w-3" />,
      className:
        "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
      description: "Full ownership of the organization",
    },
    ADMIN: {
      icon: <UserCog className="mr-1 h-3 w-3" />,
      className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
      description: "Full administrative access to the organization",
    },
    MEMBER: {
      icon: <User className="mr-1 h-3 w-3" />,
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      description: "Can view and modify organization resources",
    },
  };

  const config = roleConfig[role];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn("flex items-center", config.className)}
        >
          {config.icon}
          {role}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p>{config.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function MemberDetailsDialog({
  member,
  open,
  onOpenChange,
}: {
  member: Member;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Member Details</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">Name</div>
              <div className="text-sm text-muted-foreground">
                {member.user?.name || "N/A"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">Email</div>
              <div className="text-sm text-muted-foreground">
                {member.user?.email || "N/A"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">Role</div>
              <div className="text-sm text-muted-foreground">
                <RoleBadge role={member.role} />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveMemberDialog({
  member,
  open,
  onOpenChange,
  organizationId,
}: {
  member: Member;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}) {
  const queryClient = useQueryClient();
  const removeMutation = useMutation(
    trpc.organization.removeMember.mutationOptions({
      onSuccess: () => {
        toast.success("Member removed successfully");
        queryClient.invalidateQueries({
          queryKey: trpc.organization.listMembers.queryKey({
            organizationId,
          }),
        });
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error("Failed to remove member", {
          description: error.message || "Please try again",
        });
      },
    })
  );

  const handleRemove = () => {
    removeMutation.mutate({
      organizationId,
      memberId: member.id,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Remove Member</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove{" "}
            <span className="font-semibold">
              {member.user?.name || member.user?.email}
            </span>{" "}
            from this organization? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={removeMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleRemove}
            disabled={removeMutation.isPending}
          >
            {removeMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Removing...
              </>
            ) : (
              "Remove Member"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const columns = ({
  organizationId,
  currentUserId,
  currentUserRole,
}: {
  organizationId: string;
  currentUserId: string;
  currentUserRole: OrganizationRole;
}): ColumnDef<Member>[] => [
  {
    header: "Name",
    accessorKey: "user.name",
    cell: ({ row }) => {
      const name = row.original.user?.name;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="max-w-[120px] truncate font-medium sm:max-w-[200px]">
              {name}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{name}</p>
          </TooltipContent>
        </Tooltip>
      );
    },
    filterFn: "includesString",
  },
  {
    header: "Email",
    accessorKey: "user.email",
    cell: ({ row }) => {
      const email = row.original.user?.email;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="max-w-[150px] truncate text-sm sm:max-w-[300px]">
              {email}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{email}</p>
          </TooltipContent>
        </Tooltip>
      );
    },
    filterFn: "includesString",
  },
  {
    header: "Role",
    accessorKey: "role",
    cell: ({ row }) => {
      const role = row.original.role;
      return <RoleBadge role={role} />;
    },
    filterFn: "equals",
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const member = row.original;
      const [showDetailsDialog, setShowDetailsDialog] = useState(false);
      const [showRemoveDialog, setShowRemoveDialog] = useState(false);

      // Determine if current user can remove this member
      // Permission logic:
      // - Can't remove yourself
      // - Can't remove OWNER
      // - MEMBER role can't remove anyone
      // - ADMIN can only remove MEMBER (not other ADMINs)
      // - OWNER can remove anyone except themselves and other OWNERs
      const canRemove = (() => {
        if (member.user?.id === currentUserId) return false;
        if (member.role === "OWNER") return false;
        switch (currentUserRole) {
          case "OWNER":
            return true;
          case "ADMIN":
            return member.role === "MEMBER";
          case "MEMBER":
            return false;
          default:
            return false;
        }
      })();

      return (
        <>
          <div className="flex w-[50px] justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setShowDetailsDialog(true)}>
                  <Info className="mr-2 h-4 w-4" />
                  View Details
                </DropdownMenuItem>
                {canRemove && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setShowRemoveDialog(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove from organization
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {showDetailsDialog && (
            <MemberDetailsDialog
              member={member}
              open={showDetailsDialog}
              onOpenChange={setShowDetailsDialog}
            />
          )}

          {showRemoveDialog && (
            <RemoveMemberDialog
              member={member}
              open={showRemoveDialog}
              onOpenChange={setShowRemoveDialog}
              organizationId={organizationId}
            />
          )}
        </>
      );
    },
  },
];
