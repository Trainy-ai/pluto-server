import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import {
  RiExternalLinkLine,
  RiBookFill,
  RiDiscordFill,
} from "@remixicon/react";

interface SidebarLinksProps {
  className?: string;
}

export function SidebarLinks({ className }: SidebarLinksProps) {
  return (
    <SidebarGroup className={className}>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip="Documentation">
            <a
              href="https://docs.mlop.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              <RiBookFill className="size-2 shrink-0 translate-y-[1px] text-muted-foreground" />
              <span className="leading-none font-medium text-muted-foreground">
                Docs
              </span>
              <RiExternalLinkLine className="ml-auto size-3 shrink-0 translate-y-[1px] text-muted-foreground" />
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip="Slack Community">
            <a
              href="https://discord.gg/ybfVZgyFCX"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              <RiDiscordFill className="size-4 shrink-0 translate-y-[1px] text-muted-foreground" />
              <span className="leading-none font-medium text-muted-foreground">
                Discord
              </span>
              <RiExternalLinkLine className="ml-auto size-3 shrink-0 translate-y-[1px] text-muted-foreground" />
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
