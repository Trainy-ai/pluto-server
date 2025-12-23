import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Users, Info } from "lucide-react";
import {
  DocsTooltip,
  Tooltip,
  UnstyledTooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MembersLimitProps {
  organizationId: string;
  maxMembers: number;
}

export function MembersLimit({
  organizationId,
  maxMembers,
}: MembersLimitProps) {
  const { data: members, isLoading } = useQuery(
    trpc.organization.listMembers.queryOptions({
      organizationId,
    }),
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground/70" />
              <div className="h-6 w-40 animate-pulse rounded-md bg-muted"></div>
            </div>
            <div className="mt-1.5 h-4 w-56 animate-pulse rounded-md bg-muted"></div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Skeleton for main progress bar */}
              <div className="h-2 w-full animate-pulse rounded-full bg-muted"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!members) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Organization Members</CardTitle>
            <CardDescription>No member data available</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const totalMembers = members.length;
  const usagePercentage =
    maxMembers > 0 ? (totalMembers / maxMembers) * 100 : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Organization Members
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="ml-1 h-4 w-4 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <UnstyledTooltipContent>
                <DocsTooltip
                  title="Members Limit"
                  iconComponent={<Users className="h-4 w-4" />}
                  description={`Your organization's member limit. Your current limit is ${maxMembers} members.`}
                />
              </UnstyledTooltipContent>
            </Tooltip>
          </CardTitle>
          <CardDescription>
            {totalMembers} of {maxMembers} members
            {usagePercentage > 0 && ` (${Math.round(usagePercentage)}%)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Progress value={usagePercentage} className="h-2" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
