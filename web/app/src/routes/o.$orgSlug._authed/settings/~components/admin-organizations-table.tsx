import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { trpcClient } from "@/utils/trpc";
import { Zap } from "lucide-react";

type AdminOrganization = Awaited<
  ReturnType<typeof trpcClient.admin.listOrganizations.query>
>[number];

interface AdminOrganizationsTableProps {
  organizations: AdminOrganization[];
  pendingOrganizationId?: string;
  onUpgrade: (organizationId: string) => void;
}

export function AdminOrganizationsTable({
  organizations,
  pendingOrganizationId,
  onUpgrade,
}: AdminOrganizationsTableProps) {
  return (
    <div className="rounded-lg border bg-card">
      <Table className="table-auto">
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead className="text-right">Members</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {organizations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                No organizations found.
              </TableCell>
            </TableRow>
          ) : (
            organizations.map((organization) => (
              <TableRow key={organization.id} data-testid="admin-org-row">
                <TableCell>
                  <div className="font-medium">{organization.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {organization.slug}
                  </div>
                </TableCell>
                <TableCell>
                  {organization.owner ? (
                    <>
                      <div>{organization.owner.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {organization.owner.email}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No owner</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {organization.memberCount}
                </TableCell>
                <TableCell>
                  <PlanBadge organization={organization} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(organization.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  {organization.plan === "FREE" && organization.owner && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={pendingOrganizationId === organization.id}
                      disabled={pendingOrganizationId !== undefined}
                      onClick={() => onUpgrade(organization.id)}
                    >
                      <Zap className="mr-1 h-3 w-3" />
                      Open checkout
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function PlanBadge({ organization }: { organization: AdminOrganization }) {
  if (organization.plan === "PRO") {
    return (
      <Badge variant="default">{organization.isEducationPlan ? "Pro (edu)" : "Pro"}</Badge>
    );
  }
  if (organization.plan === "FREE") {
    return <Badge variant="secondary">Free</Badge>;
  }
  return <Badge variant="outline">No subscription</Badge>;
}
