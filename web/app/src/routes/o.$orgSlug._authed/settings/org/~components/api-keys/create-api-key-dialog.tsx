import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon, CheckCircle2, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface CreateApiKeyDialogProps {
  organizationId: string;
  onSuccess?: () => void;
}

export function CreateApiKeyDialog({
  organizationId,
  onSuccess,
}: CreateApiKeyDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isSecured, setIsSecured] = useState(true);
  const [expiresAt, setExpiresAt] = useState<Date>();
  const [createdApiKey, setCreatedApiKey] = useState<string>();
  const queryClient = useQueryClient();

  const { mutateAsync: createApiKey, isPending } = useMutation(
    trpc.organization.apiKey.createApiKey.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [["organization", "listApiKeys"]],
        });
      },
    }),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate expiration date is in the future
    if (expiresAt && expiresAt < new Date()) {
      toast.error("Expiration date must be in the future");
      return;
    }

    try {
      const result = await createApiKey({
        name,
        organizationId,
        isSecured,
        expiresAt,
      });

      setCreatedApiKey(result.apiKey);
      onSuccess?.();
      toast.success("API key created successfully");
    } catch (error) {
      toast.error("Failed to create API key");
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Only reset if we're closing
      setName("");
      setExpiresAt(undefined);
      setCreatedApiKey(undefined);
    }
    setOpen(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>Create API Key</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]">
        {!createdApiKey ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg sm:text-xl">
                Create API Key
              </DialogTitle>
              <DialogDescription className="text-sm">
                Create a new API key for your organization. You can use this to
                ingest data into your organization.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="grid gap-6">
              <div className="grid gap-4 sm:gap-6">
                <div className="grid gap-2 sm:gap-3">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Production API Key"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="secured">Security Level</Label>
                  <div className="flex items-center justify-between rounded-lg border p-3 sm:p-4">
                    <div className="space-y-0.5">
                      <Label>Secure API Key</Label>
                      <div className="mt-1 text-xs text-balance text-muted-foreground sm:text-[0.8rem]">
                        {isSecured
                          ? "The API key will be hashed in the database and can't be retrieved later"
                          : "The API key will be stored in plain text and can be viewed later"}
                      </div>
                    </div>
                    <Switch
                      id="secured"
                      checked={isSecured}
                      onCheckedChange={setIsSecured}
                    />
                  </div>
                </div>

                <div className="grid gap-3">
                  <Label>Expiration Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !expiresAt && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {expiresAt ? (
                          format(expiresAt, "PPP")
                        ) : (
                          <span>Pick a date</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={expiresAt}
                        onSelect={setExpiresAt}
                        initialFocus
                        disabled={(date) => date < new Date()}
                      />
                    </PopoverContent>
                  </Popover>
                  <p className="text-[0.8rem] text-muted-foreground">
                    Optional. If not set, the API key will never expire.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Creating..." : "Create API Key"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-500" />
                <div className="flex flex-col gap-1">
                  <DialogTitle>API Key Created Successfully</DialogTitle>
                  <DialogDescription>
                    {name}{" "}
                    {expiresAt
                      ? `(Expires: ${format(expiresAt, "PPP")})`
                      : "(Never expires)"}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>API Key</Label>
                <div className="flex items-center justify-between gap-2 rounded-md bg-muted p-4">
                  <code className="font-mono text-xs break-all sm:text-sm">
                    {createdApiKey}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 flex-shrink-0 bg-background/80 p-0 hover:bg-background/50"
                    onClick={() => {
                      navigator.clipboard.writeText(createdApiKey);
                      toast.success("API key copied to clipboard", {
                        position: "bottom-right",
                      });
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                {isSecured ? (
                  <Alert variant="warning" className="text-sm">
                    <AlertDescription>
                      <span className="font-bold">Warning:</span> Make sure to
                      copy your API key now. For security reasons, you won't be
                      able to see it again!
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="info" className="text-sm">
                    <AlertDescription>
                      You can view this API key again later since it's stored in
                      plain text.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
