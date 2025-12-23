const keysToStrip = ["requirements", "git", "process"];

export function stripSystemMetadata(systemMetadata: any) {
  // if it is a object, remove the top level keys that are in the keysToStrip array
  if (typeof systemMetadata === "object" && systemMetadata !== null) {
    return Object.fromEntries(
      Object.entries(systemMetadata).filter(
        ([key]) => !keysToStrip.includes(key),
      ),
    );
  }
  // if it is a JSON string, parse it and remove the top level keys that are in the keysToStrip array
  if (typeof systemMetadata === "string") {
    const parsed = JSON.parse(systemMetadata);
    return Object.fromEntries(
      Object.entries(parsed).filter(([key]) => !keysToStrip.includes(key)),
    );
  }

  //try and parse it as JSON
  try {
    const parsed = JSON.parse(systemMetadata);
    return Object.fromEntries(
      Object.entries(parsed).filter(([key]) => !keysToStrip.includes(key)),
    );
  } catch (error) {
    console.error("Failed to parse system metadata:", error);
    return systemMetadata;
  }
}
