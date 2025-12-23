import * as React from "react";
import { SearchIcon, XIcon } from "lucide-react";

import { Button } from "./button";
import {
  InputWithAdornments,
  type InputWithAdornmentsElement,
  type InputWithAdornmentsProps,
} from "./input-with-adornments";

export type InputSearchProps = Omit<
  InputWithAdornmentsProps,
  "startAdornment" | "endAdornment"
> & {
  debounceTime?: number;
  onClear?: () => void;
  clearButtonProps?: React.ComponentProps<typeof Button>;
  alwaysShowClearButton?: boolean;
};

export const InputSearch = React.forwardRef<
  InputWithAdornmentsElement,
  InputSearchProps
>(
  (
    {
      onChange,
      value,
      disabled,
      debounceTime = 175,
      onClear,
      clearButtonProps,
      alwaysShowClearButton,
      ...props
    },
    ref,
  ) => {
    const [innerValue, setInnerValue] = React.useState(value || "");
    const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    React.useEffect(() => {
      setInnerValue(value || "");
    }, [value]);

    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = event.target.value;
        setInnerValue(newValue);

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
          onChange?.(event);
        }, debounceTime);
      },
      [onChange, debounceTime],
    );

    const handleClear = React.useCallback(() => {
      setInnerValue("");
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      onChange?.({
        target: { value: "" },
      } as React.ChangeEvent<HTMLInputElement>);
      onClear?.();
    }, [onChange, onClear]);

    React.useEffect(() => {
      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    }, []);

    return (
      <InputWithAdornments
        ref={ref}
        disabled={disabled}
        value={innerValue}
        onChange={handleChange}
        startAdornment={<SearchIcon className="size-4 shrink-0" />}
        endAdornment={
          alwaysShowClearButton || innerValue ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-mr-2.5 flex size-8"
              onClick={handleClear}
              {...clearButtonProps}
            >
              <XIcon className="size-4 shrink-0" />
            </Button>
          ) : undefined
        }
        {...props}
      />
    );
  },
);

InputSearch.displayName = "InputSearch";
