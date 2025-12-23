import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "@tanstack/react-router";
import CodeBlock from "@/components/ui/code-block";
import { X } from "lucide-react";
import { useGettingStartedVisibility } from "../~hooks/use-getting-started";

interface GettingStartedProps {
  orgSlug: string;
}

const getStorageKey = (orgSlug: string) => `getting-started-hidden`;

// Code snippets
const LOGIN_CODE = `import mlop\nmlop.login()`;

const LOGGER_SETUP_CODE = `config = {
  "learning_rate": 0.02,
  "architecture": "CNN",
  "dataset": "CIFAR-100",
  "epochs": 10,
}

# 1. initialize a run
logger = mlop.init(
  project="example",
  name="simulation-standard", # will be auto-generated if left unspecified
  config=config,
)`;

const TRAINING_CODE = `epochs = 10
offset = random.random() / 5
for epoch in range(1, epochs+1):
  acc = 1 - 2**-epoch - random.random() / epoch - offset
  loss = 2**-epoch + random.random() / epoch + offset

  # record metrics from the script to mlop
  logger.log({"acc": acc, "loss": loss})
  print(f"Epoch {epoch}/{epochs}")

# mark the run as finished
logger.finish()`;

export function GettingStarted({ orgSlug }: GettingStartedProps) {
  const { visibility, setVisibility } = useGettingStartedVisibility({
    orgSlug,
  });

  const handleHide = () => {
    setVisibility(true);
  };

  if (visibility === "hidden") {
    return null;
  }

  return (
    <section className="relative rounded-lg border bg-card p-4 sm:p-8">
      <div className="absolute top-2 right-2 flex items-center gap-2 sm:top-4 sm:right-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleHide}
          className="text-xs text-muted-foreground hover:text-foreground sm:text-sm"
        >
          <X className="mr-2 h-3 w-3 sm:h-4 sm:w-4" />
          Hide Getting Started
        </Button>
      </div>

      <div className="mb-6 sm:mb-8">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
          Getting Started
        </h2>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Follow these steps to get started with our platform and begin tracking
          your ML experiments.
        </p>
      </div>

      <Alert className="mb-6 border-primary/20 bg-primary/5 sm:mb-8">
        <AlertTitle className="text-sm font-medium text-primary sm:text-base">
          Try it out instantly
        </AlertTitle>
        <AlertDescription>
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-sm text-muted-foreground sm:text-base">
              Want to explore without any setup? Check out our interactive
              Jupyter notebook for a hands-on experience.
            </p>
            <div>
              <Button size="sm" className="w-full sm:w-fit">
                <a
                  href="https://colab.research.google.com/github/mlop-ai/mlop/blob/main/examples/intro.ipynb"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-xs sm:text-sm"
                >
                  Open Google Colab Notebook
                </a>
              </Button>
            </div>
          </div>
        </AlertDescription>
      </Alert>

      <div className="relative flex flex-col gap-4">
        <Card className="relative bg-muted/50 transition-all hover:shadow-md">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="flex items-center gap-3 text-base sm:text-lg">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary ring-4 ring-background sm:h-8 sm:w-8 sm:text-sm">
                1
              </span>
              Generate API Keys
            </CardTitle>
            <CardDescription className="mt-2 text-sm sm:text-base">
              Create your API keys to start using our platform in your own
              environment. These keys will allow you to authenticate your
              requests and track your experiments.
            </CardDescription>
            <div className="mt-4">
              <Button className="w-full sm:w-fit">
                <Link
                  to="/o/$orgSlug/settings/org/developers"
                  params={{ orgSlug }}
                  className="inline-flex items-center gap-2 text-xs sm:text-sm"
                >
                  Create API Key
                </Link>
              </Button>
            </div>
          </CardHeader>
        </Card>

        <Card className="relative bg-muted/50 transition-all hover:shadow-md">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="flex items-center gap-3 text-base sm:text-lg">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary ring-4 ring-background sm:h-8 sm:w-8 sm:text-sm">
                2
              </span>
              Login using API Key
            </CardTitle>
            <CardDescription className="mt-2 flex flex-col gap-2 text-sm sm:text-base">
              <p>
                Call the{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs sm:text-sm">
                  mlop.login
                </code>{" "}
                function with your API key to login and enter your API key
              </p>
              <CodeBlock
                code={LOGIN_CODE}
                language="python"
                fontSize="sm"
                showLineNumbers={false}
              />
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="relative bg-muted/50 transition-all hover:shadow-md">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="flex items-center gap-3 text-base sm:text-lg">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary ring-4 ring-background sm:h-8 sm:w-8 sm:text-sm">
                3
              </span>
              Set up your logger
            </CardTitle>
            <CardDescription className="mt-2 text-sm sm:text-base">
              Set up your logger to start tracking your experiments. Here's an
              example of how to initialize a run with configuration and log
              metrics:
            </CardDescription>
            <div className="mt-2">
              <CodeBlock
                code={LOGGER_SETUP_CODE}
                language="python"
                fontSize="sm"
                showLineNumbers={false}
              />
            </div>
          </CardHeader>
        </Card>

        <Card className="relative bg-muted/50 transition-all hover:shadow-md">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="flex items-center gap-3 text-base sm:text-lg">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary ring-4 ring-background sm:h-8 sm:w-8 sm:text-sm">
                4
              </span>
              Train Your Model
            </CardTitle>
            <CardDescription className="mt-2 text-sm sm:text-base">
              Train your model as usual, and log metrics to mlop
            </CardDescription>
            <div className="mt-2">
              <CodeBlock
                code={TRAINING_CODE}
                language="python"
                fontSize="sm"
                showLineNumbers={false}
              />
            </div>
          </CardHeader>
        </Card>

        <Card className="relative bg-muted/50 transition-all hover:shadow-md">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="flex items-center gap-3 text-base sm:text-lg">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary ring-4 ring-background sm:h-8 sm:w-8 sm:text-sm">
                5
              </span>
              Visualize your experiments
            </CardTitle>
            <CardDescription className="mt-2 text-sm sm:text-base">
              When the run starts you will be given a link to the dashboard
              where you can visualize your data in realtime
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </section>
  );
}
