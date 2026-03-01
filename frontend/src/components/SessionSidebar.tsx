import { formatDistanceToNow } from "date-fns";
import { Plus, Settings, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { SessionMeta } from "@/lib/types";

interface SessionSidebarProps {
  sessions: SessionMeta[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onNavigate: (page: "profile" | "settings") => void;
  activePage: string;
}

function timeAgo(isoDate: string): string {
  try {
    return formatDistanceToNow(new Date(isoDate), { addSuffix: true });
  } catch {
    return isoDate;
  }
}

export function SessionSidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onNavigate,
  activePage,
}: SessionSidebarProps) {
  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <span className="font-semibold text-lg">AutoApprops</span>
      </SidebarHeader>

      <SidebarContent>
        <div className="px-3 pt-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={onNewSession}
          >
            <Plus className="h-4 w-4" />
            New Session
          </Button>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel>Session History</SidebarGroupLabel>
          <SidebarMenu>
            {sessions.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No sessions yet. Process a form to get started.
              </p>
            )}
            {sessions.map((session) => (
              <SidebarMenuItem key={session.id}>
                <SidebarMenuButton
                  isActive={currentSessionId === session.id}
                  onClick={() => onSelectSession(session.id)}
                  className="h-auto py-2 items-start"
                >
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-sm font-medium truncate">
                      {session.form_title || "Untitled Form"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {session.document_filename}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(session.created_at)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                        className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                        title="Delete session"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activePage === "profile"}
              onClick={() => onNavigate("profile")}
            >
              <User className="h-4 w-4" />
              Profile
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activePage === "settings"}
              onClick={() => onNavigate("settings")}
            >
              <Settings className="h-4 w-4" />
              Settings
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
