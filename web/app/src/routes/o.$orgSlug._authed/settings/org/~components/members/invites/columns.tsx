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
  Copy,
  Eye,
  EyeOff,
  MoreHorizontal,
  Trash2,
  Info,
  CheckCircle,
  Clock,
  XCircle,
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

type Invite = inferOutput<typeof trpc.organization.invite.listSentInvites>[0];

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
    toast.success("API key copied to clipboard");
  } catch (err) {
    toast.error("Failed to copy API key");
  }
};

function RoleBadge({ role }: { role: string }) {
  const roleColorMap: Record<string, string> = {
    OWNER: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    ADMIN: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    MEMBER: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  };

  const roleDescriptions: Record<string, string> = {
    OWNER: "Full administrative access to the organization",
    ADMIN:
      "Full administrative access to the organization, but can not do destructive actions",
    MEMBER: "Can view and upload data only",
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "font-medium",
            roleColorMap[role] ||
              "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
          )}
        >
          {role}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p>{roleDescriptions[role] || `Role: ${role}`}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function StatusBadge({ status }: { status: string }) {
  // Define styles and icons based on status
  const statusConfig: Record<
    string,
    { icon: React.ReactNode; className: string; description: string }
  > = {
    PENDING: {
      icon: <Clock className="mr-1 h-3 w-3" />,
      className:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      description: "Invitation has been sent but not yet accepted",
    },
    ACCEPTED: {
      icon: <CheckCircle className="mr-1 h-3 w-3" />,
      className:
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      description: "Invitation has been accepted by the recipient",
    },
    REJECTED: {
      icon: <XCircle className="mr-1 h-3 w-3" />,
      className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
      description: "Invitation was rejected by the recipient",
    },
    EXPIRED: {
      icon: <Clock className="mr-1 h-3 w-3" />,
      className:
        "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
      description: "Invitation has expired and is no longer valid",
    },
  };

  const config = statusConfig[status] || {
    icon: null,
    className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
    description: `Status: ${status}`,
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn("flex items-center", config.className)}
        >
          {config.icon}
          {status}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p>{config.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function DeleteInviteDialog({
  invite,
  organizationId,
  open,
  onOpenChange,
}: {
  invite: Invite;
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const { mutate: deleteInvite, isPending } = useMutation({
    mutationFn: () => {
      return Promise.resolve();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [["organization", "invite", "listSentInvites"]],
      });
      toast.success("Invite deleted successfully");
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Failed to delete invite");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Invite</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this invitation? This action cannot
            be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">Invite Details</div>
            <div className="text-sm text-muted-foreground">
              Email: {invite.email}
              {invite.expiresAt && (
                <> • Expires: {formatDate(new Date(invite.expiresAt))}</>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteInvite()}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete Invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteDetailsDialog({
  invite,
  open,
  onOpenChange,
}: {
  invite: Invite;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Invite Details</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">Email</div>
              <div className="text-sm text-muted-foreground">
                {invite.email}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">Role</div>
              <div className="text-sm text-muted-foreground">
                <RoleBadge role={invite.role} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">Status</div>
              <div className="text-sm text-muted-foreground">
                <StatusBadge status={invite.status} />
              </div>
            </div>

            {invite.expiresAt && (
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Expires At</div>
                <div className="text-sm text-muted-foreground">
                  {formatDate(new Date(invite.expiresAt))}
                </div>
              </div>
            )}

            {invite.inviter && (
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Invited By</div>
                <div className="text-sm text-muted-foreground">
                  {`${invite.inviter.name} (${invite.inviter.email})`}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const columns = ({
  organizationId,
}: {
  organizationId: string;
}): ColumnDef<Invite>[] => [
  {
    header: "Email",
    accessorKey: "email",
    cell: ({ row }) => {
      const email = row.original.email;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="max-w-[120px] truncate font-medium sm:max-w-[200px]">
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
    header: "Status",
    accessorKey: "status",
    cell: ({ row }) => {
      const status = row.original.status;
      return <StatusBadge status={status} />;
    },
    filterFn: "equals",
  },
  {
    header: "Expires",
    accessorKey: "expiresAt",
    cell: ({ row }) => {
      const expiresAt = row.original.expiresAt;
      const formattedDate = expiresAt
        ? formatDate(new Date(expiresAt))
        : "Never";
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="max-w-[100px] truncate text-sm sm:max-w-[180px]">
              {formattedDate}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{formattedDate}</p>
          </TooltipContent>
        </Tooltip>
      );
    },
  },
  {
    header: "Invited By",
    accessorKey: "inviter",
    cell: ({ row }) => {
      const inviter = row.original.inviter;
      const inviterText = inviter
        ? `${inviter.name} (${inviter.email})`
        : "N/A";
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="max-w-[100px] truncate text-sm sm:max-w-[180px]">
              {inviterText}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{inviterText}</p>
          </TooltipContent>
        </Tooltip>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const invite = row.original;
      const [showDeleteDialog, setShowDeleteDialog] = useState(false);
      const [showDetailsDialog, setShowDetailsDialog] = useState(false);

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
                {/* TODO: Add delete invite */}
                <DropdownMenuSeparator />
                {/* <DropdownMenuItem
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-red-600"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Invite
                </DropdownMenuItem> */}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {showDeleteDialog && (
            <DeleteInviteDialog
              invite={invite}
              organizationId={organizationId}
              open={showDeleteDialog}
              onOpenChange={setShowDeleteDialog}
            />
          )}

          {showDetailsDialog && (
            <InviteDetailsDialog
              invite={invite}
              open={showDetailsDialog}
              onOpenChange={setShowDetailsDialog}
            />
          )}
        </>
      );
    },
  },
];
