export const RunNotFound = () => {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <h1 className="text-2xl font-bold">Run not found</h1>
      <p className="text-sm text-muted-foreground">
        The run you are looking for does not exist or you don't have access to
        it.
      </p>
    </div>
  );
};
