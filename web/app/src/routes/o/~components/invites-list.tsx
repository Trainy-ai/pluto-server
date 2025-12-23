import {
  Card,
  CardTitle,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";
import { trpc } from "@/utils/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Mail, Building2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { TRPCClientError } from "@trpc/client";

interface InvitesListProps {
  titleStyle?: string;
  redirect?: string;
}

const InvitesList = ({ titleStyle, redirect }: InvitesListProps) => {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery(
    trpc.organization.invite.myInvites.queryOptions(),
  );

  const acceptInviteMutation = useMutation(
    trpc.organization.invite.acceptInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invitation accepted");
        // invalidate the query to refetch the data
        queryClient.invalidateQueries();
        if (redirect) {
          window.location.href = redirect;
        } else {
          // reload the page to refresh the data
          window.location.reload();
        }
      },
      onError: (error) => {
        if (error instanceof TRPCClientError) {
          toast.error(error.message);
        } else {
          toast.error("Failed to accept invitation");
        }
        console.error(error);
      },
    }),
  );

  const rejectInviteMutation = useMutation(
    trpc.organization.invite.rejectInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invitation rejected");
        // invalidate the query to refetch the data
        queryClient.invalidateQueries();
        if (redirect) {
          window.location.href = redirect;
        } else {
          // reload the page to refresh the data
          window.location.reload();
        }
      },
      onError: () => {
        toast.error("Failed to reject invitation");
      },
    }),
  );

  const handleAccept = (inviteId: string) => {
    // Do not allow for spamming the mutation when an existing mutation is pending
    if (!acceptInviteMutation.isPending) {
      acceptInviteMutation.mutate({ invitationId: inviteId });
    }
  };

  const handleReject = (inviteId: string) => {
    // Do not allow for spamming the mutation when an existing mutation is pending
    if (!rejectInviteMutation.isPending) {
      rejectInviteMutation.mutate({ invitationId: inviteId });
    }
  };

  if (isLoading) {
    return <Skeleton className="h-full w-full" />;
  }

  if (isError) {
    return (
      <Card className="border-none shadow-none">
        <CardHeader className="text-center">
          <CardTitle className="text-red-500">Error Loading Invites</CardTitle>
          <CardDescription>
            There was a problem loading your invitations. Please try again
            later.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (data?.length === 0) {
    return null;
  }

  return (
    <Card className="h-full rounded-xl bg-muted/50 p-6">
      <div className="mb-6">
        <h2 className={cn("text-2xl font-semibold", titleStyle)}>
          Pending Invites
        </h2>
      </div>
      <div className="space-y-2">
        {data?.map((invite) => (
          <div
            key={invite.id}
            className="flex flex-col gap-4 rounded-lg border bg-card p-4 transition-colors sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {invite.organization.name}
                </p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="size-3.5 shrink-0" />
                  <span className="truncate">
                    Invited by {invite.user.email}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 sm:flex-shrink-0">
              <Button
                onClick={() => handleAccept(invite.id)}
                size="sm"
                className={cn(
                  "flex-1 cursor-pointer bg-green-600/90 text-white transition-colors hover:bg-green-600 sm:flex-initial",
                  acceptInviteMutation.isPending &&
                    "cursor-not-allowed opacity-50",
                )}
                disabled={acceptInviteMutation.isPending}
              >
                {acceptInviteMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                Accept
              </Button>
              <Button
                onClick={() => handleReject(invite.id)}
                size="sm"
                variant="outline"
                className={cn(
                  "flex-1 cursor-pointer border-red-200/20 text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 sm:flex-initial",
                  rejectInviteMutation.isPending &&
                    "cursor-not-allowed opacity-50",
                )}
                disabled={rejectInviteMutation.isPending}
              >
                {rejectInviteMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default InvitesList;
