/**
 * wandb's own Vega/Vega-Lite preset specs, verbatim.
 *
 * A migrated `wandb.plot.*` panel arrives as a `panelDefId` plus a field->column
 * mapping; the spec itself stays on wandb's servers, so a migrated run has the
 * ingredients and no recipe. These are those recipes, fetched once from wandb's
 * public `customChart(id:)` GraphQL query and frozen here.
 *
 * Copied rather than reimplemented so the charts are what wandb draws, not an
 * approximation of it -- horizontal grouped bars, `bin: true`'s bin widths, the
 * scatter's red gradient legend, the confusion matrix's normalise toggle. An
 * earlier hand-written set of templates got all four of those wrong.
 *
 * The ids are the `vega_spec_name` constants in the wandb SDK's `wandb/plot/*.py`.
 * Note `pr_curve` and `roc_curve` share `area-under-curve`, and that only `bar`,
 * `histogram`, `line`, `scatter` are reached via a non-null `preset` -- the rest
 * arrive with `preset: null`, so dispatch is by `panelDefId`.
 *
 * `${field:x}` / `${string:title}` placeholders are substituted at render time
 * (see `custom-chart-view.tsx`). `confusion_matrix/v1` is raw Vega, not
 * Vega-Lite; vega-embed dispatches on `$schema`, so both render unchanged.
 *
 * Regenerate with the GraphQL query in this file's git history if wandb ships a
 * new preset version -- these are versioned ids, so existing ones do not change.
 */

/** Preset spec by wandb `panelDefId`. */
export const WANDB_PRESET_SPECS: Record<string, Record<string, unknown>> = {
  "wandb/area-under-curve/v0": {
    "$schema": "https://vega.github.io/schema/vega-lite/v4.json",
    "data": {
      "name": "wandb"
    },
    "description": "An area under curve plot, used for pr and roc curves",
    "encoding": {
      "x": {
        "axis": {
          "title": "${string:x-axis-title}"
        },
        "field": "${field:x}",
        "type": "quantitative"
      },
      "y": {
        "axis": {
          "title": "${string:y-axis-title}"
        },
        "field": "${field:y}",
        "type": "quantitative"
      }
    },
    "layer": [
      {
        "encoding": {
          "color": {
            "field": "newGroupKeys",
            "legend": {
              "title": " "
            },
            "scale": {
              "range": "category"
            },
            "type": "nominal"
          },
          "strokeDash": {
            "field": "${field:class}",
            "legend": {
              "symbolType": "stroke"
            }
          }
        },
        "mark": {
          "size": 75,
          "tooltip": {
            "content": "data"
          },
          "type": "point"
        },
        "selection": {
          "grid": {
            "bind": "scales",
            "type": "interval"
          }
        },
        "transform": [
          {
            "filter": "datum.grouped == true"
          }
        ]
      },
      {
        "encoding": {
          "color": {
            "field": "name",
            "legend": {
              "title": " "
            },
            "scale": {
              "range": {
                "field": "color"
              }
            },
            "type": "nominal"
          },
          "strokeDash": {
            "field": "${field:class}"
          }
        },
        "mark": {
          "tooltip": {
            "content": "data"
          },
          "type": "line"
        },
        "transform": [
          {
            "filter": "datum.grouped == false"
          }
        ]
      },
      {
        "encoding": {
          "opacity": {
            "condition": {
              "selection": "hover",
              "value": 0.6
            },
            "value": 0.0
          }
        },
        "mark": {
          "tooltip": {
            "content": "data"
          },
          "type": "point"
        },
        "selection": {
          "hover": {
            "clear": "mouseout",
            "empty": "none",
            "fields": [
              "${field:x}",
              "${field:y}"
            ],
            "nearest": true,
            "on": "mouseover",
            "type": "single"
          }
        }
      }
    ],
    "resolve": {
      "scale": {
        "color": "independent"
      }
    },
    "title": "${string:title}",
    "transform": [
      {
        "as": "grouped",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', false, true)"
      },
      {
        "as": "newGroupKeys",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', datum.name, datum['${field:groupKeys}'])"
      },
      {
        "as": "color",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', datum.color, datum['${field:groupKeys}'])"
      },
      {
        "aggregate": [
          {
            "as": "${field:y}",
            "field": "${field:y}",
            "op": "average"
          }
        ],
        "groupby": [
          "class",
          "newGroupKeys",
          "${field:x}",
          "color",
          "grouped",
          "name"
        ]
      }
    ]
  },
  "wandb/bar/v0": {
    "$schema": "https://vega.github.io/schema/vega-lite/v4.json",
    "data": {
      "name": "wandb"
    },
    "description": "A simple bar chart",
    "layer": [
      {
        "encoding": {
          "color": {
            "field": "newGroupKeys",
            "legend": {
              "title": null
            },
            "scale": {
              "range": {
                "field": "color"
              }
            },
            "type": "nominal"
          },
          "opacity": {
            "value": 0.6
          },
          "x": {
            "field": "${field:value}",
            "stack": null,
            "type": "quantitative"
          },
          "y": {
            "field": "${field:label}",
            "type": "nominal"
          },
          "yOffset": {
            "field": "newGroupKeys"
          }
        },
        "mark": {
          "tooltip": {
            "content": "data"
          },
          "type": "bar"
        },
        "transform": [
          {
            "filter": "datum.grouped === false"
          }
        ]
      },
      {
        "encoding": {
          "color": {
            "field": "newGroupKeys",
            "legend": {
              "title": null
            },
            "scale": {
              "range": "category"
            },
            "type": "nominal"
          },
          "opacity": {
            "value": 0.6
          },
          "x": {
            "field": "${field:value}",
            "stack": false,
            "type": "quantitative"
          },
          "y": {
            "field": "${field:label}",
            "type": "nominal"
          },
          "yOffset": {
            "field": "newGroupKeys"
          }
        },
        "mark": {
          "tooltip": {
            "content": "data"
          },
          "type": "bar"
        },
        "transform": [
          {
            "filter": "datum.grouped === true"
          }
        ]
      }
    ],
    "resolve": {
      "scale": {
        "color": "independent"
      }
    },
    "title": "${string:title}",
    "transform": [
      {
        "as": "grouped",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', false, true)"
      },
      {
        "as": "newGroupKeys",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', datum.name, datum['${field:groupKeys}'])"
      },
      {
        "as": "color",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', datum.color, datum['${field:groupKeys}'])"
      },
      {
        "aggregate": [
          {
            "as": "${field:value}",
            "field": "${field:value}",
            "op": "average"
          }
        ],
        "groupby": [
          "${field:label}",
          "newGroupKeys",
          "color",
          "grouped"
        ]
      }
    ]
  },
  "wandb/confusion_matrix/v1": {
    "$schema": "https://vega.github.io/schema/vega/v5.json",
    "autosize": "fit-y",
    "axes": [
      {
        "domain": false,
        "labelAlign": "center",
        "labelAngle": -90,
        "labelOverlap": true,
        "labelPadding": 0,
        "offset": {
          "signal": "-0.01*width"
        },
        "orient": "left",
        "scale": "yscale",
        "tickSize": 0,
        "title": "Actual"
      },
      {
        "domain": false,
        "labelOverlap": true,
        "labelPadding": -5,
        "orient": "top",
        "scale": "xscale",
        "tickSize": 0,
        "title": "Predicted"
      }
    ],
    "data": [
      {
        "name": "wandb",
        "transform": [
          {
            "expr": "if(indexof(split(classesToFilter, ','), datum.${field:Actual})==-1 && filterClasses, false, true)",
            "type": "filter"
          },
          {
            "expr": "if(indexof(split(classesToFilter, ','), datum.${field:Predicted})==-1 && filterClasses, false, true)",
            "type": "filter"
          },
          {
            "as": [
              "countActClass"
            ],
            "fields": [
              "${field:nPredictions}"
            ],
            "groupby": [
              "name",
              "Actual"
            ],
            "ops": [
              "sum"
            ],
            "type": "joinaggregate"
          },
          {
            "as": "maybeNormalizedCount",
            "expr": "if(Normalized, datum.${field:nPredictions}/datum.countActClass, datum.${field:nPredictions})",
            "type": "formula"
          }
        ]
      },
      {
        "name": "maxVals",
        "source": "wandb",
        "transform": [
          {
            "as": [
              "maximumValue"
            ],
            "fields": [
              "maybeNormalizedCount"
            ],
            "ops": [
              "max"
            ],
            "type": "aggregate"
          }
        ]
      }
    ],
    "description": "Multi-run confusion matrix with options for normalization",
    "marks": [
      {
        "axes": [
          {
            "domain": true,
            "grid": false,
            "labelOverlap": true,
            "labels": true,
            "offset": {
              "signal": "height"
            },
            "orient": "bottom",
            "scale": "cat2",
            "ticks": true
          }
        ],
        "encode": {
          "update": {
            "x": {
              "field": "${field:Predicted}",
              "scale": "xscale"
            }
          }
        },
        "from": {
          "facet": {
            "data": "wandb",
            "groupby": [
              "${field:Predicted}"
            ],
            "name": "facet"
          }
        },
        "scales": [
          {
            "domain": [
              0,
              {
                "signal": "domainMax"
              }
            ],
            "name": "cat2",
            "range": "width",
            "type": "linear",
            "zero": true
          },
          {
            "domain": [
              0,
              1
            ],
            "name": "catNorm",
            "range": "width",
            "type": "linear",
            "zero": true
          },
          {
            "domain": {
              "data": "wandb",
              "field": "name",
              "sort": true
            },
            "name": "catName",
            "range": "height",
            "type": "ordinal"
          }
        ],
        "signals": [
          {
            "name": "width",
            "update": "bandwidth('xscale')"
          }
        ],
        "type": "group"
      },
      {
        "axes": [
          {
            "domain": true,
            "grid": false,
            "labels": false,
            "orient": "left",
            "scale": "cat1",
            "ticks": true
          },
          {
            "domain": true,
            "grid": false,
            "labels": false,
            "offset": {
              "signal": "-width"
            },
            "orient": "left",
            "scale": "cat1",
            "ticks": false
          },
          {
            "grid": true,
            "labels": false,
            "orient": "top",
            "scale": "cat2",
            "ticks": false
          },
          {
            "domain": true,
            "grid": false,
            "labels": false,
            "offset": {
              "signal": "height"
            },
            "orient": "bottom",
            "scale": "cat2",
            "ticks": false
          }
        ],
        "encode": {
          "enter": {
            "x": {
              "field": "${field:Predicted}",
              "scale": "xscale"
            },
            "y": {
              "field": "${field:Actual}",
              "scale": "yscale"
            }
          },
          "update": {
            "x": {
              "field": "${field:Predicted}",
              "scale": "xscale"
            },
            "y": {
              "field": "${field:Actual}",
              "scale": "yscale"
            }
          }
        },
        "from": {
          "facet": {
            "data": "wandb",
            "groupby": [
              "${field:Actual}",
              "${field:Predicted}"
            ],
            "name": "facet"
          }
        },
        "marks": [
          {
            "encode": {
              "update": {
                "fill": {
                  "field": "color"
                },
                "height": {
                  "band": 1.0,
                  "scale": "cat1"
                },
                "opacity": [
                  {
                    "test": "selectedRun == '' || (selectedRun != '' && datum.name == selectedRun)",
                    "value": 1.0
                  },
                  {
                    "value": 0.25
                  }
                ],
                "tooltip": [
                  {
                    "signal": "{'Count': datum.maybeNormalizedCount, 'Run name': datum.name}"
                  }
                ],
                "x": {
                  "field": "maybeNormalizedCount",
                  "scale": "cat2"
                },
                "x2": {
                  "scale": "cat2",
                  "value": 0
                },
                "y": {
                  "field": "name",
                  "scale": "cat1"
                }
              }
            },
            "from": {
              "data": "facet"
            },
            "name": "bars",
            "type": "rect"
          }
        ],
        "scales": [
          {
            "domain": {
              "data": "facet",
              "field": "name",
              "sort": true
            },
            "name": "cat1",
            "range": "height",
            "type": "band"
          },
          {
            "domain": [
              0,
              {
                "signal": "domainMax"
              }
            ],
            "name": "cat2",
            "range": "width",
            "type": "linear",
            "zero": true
          }
        ],
        "signals": [
          {
            "name": "height",
            "update": "bandwidth('yscale')"
          },
          {
            "name": "width",
            "update": "bandwidth('xscale')"
          }
        ],
        "type": "group"
      }
    ],
    "scales": [
      {
        "domain": {
          "data": "wandb",
          "field": "${field:Actual}",
          "sort": true
        },
        "name": "yscale",
        "padding": 0.2,
        "range": "height",
        "type": "band"
      },
      {
        "domain": {
          "data": "wandb",
          "field": "${field:Predicted}",
          "sort": true
        },
        "name": "xscale",
        "padding": 0.3,
        "range": "width",
        "round": true,
        "type": "band"
      },
      {
        "domain": {
          "data": "wandb",
          "field": "name",
          "sort": true
        },
        "name": "colorScale",
        "range": {
          "data": "wandb",
          "field": "color"
        },
        "type": "ordinal"
      }
    ],
    "signals": [
      {
        "init": "isFinite(containerSize()[0]) ? containerSize()[0] : 200",
        "name": "width",
        "on": [
          {
            "events": "window:resize",
            "update": "isFinite(containerSize()[0]) ? containerSize()[0] : 200"
          },
          {
            "events": {
              "throttle": 1000,
              "type": "timer"
            },
            "update": "isFinite(containerSize()[0]) ? containerSize()[0] : 200"
          }
        ]
      },
      {
        "init": "isFinite(containerSize()[1]) ? containerSize()[1] : 200",
        "name": "height",
        "on": [
          {
            "events": "window:resize",
            "update": "isFinite(containerSize()[1]) ? containerSize()[1] : 200"
          },
          {
            "events": {
              "throttle": 1000,
              "type": "timer"
            },
            "update": "isFinite(containerSize()[1]) ? containerSize()[1] : 200"
          }
        ]
      },
      {
        "bind": {
          "input": "checkbox"
        },
        "name": "filterClasses",
        "value": false
      },
      {
        "bind": {
          "input": "input",
          "placeholder": "Comma separated classes to compare",
          "size": 80
        },
        "description": "A comma separated list of classes",
        "name": "classesToFilter",
        "value": ""
      },
      {
        "name": "selectedRun",
        "on": [
          {
            "events": [
              {
                "marktype": "rect",
                "type": "click"
              }
            ],
            "update": "if(selectedRun == datum.name, '', datum.name)"
          }
        ],
        "value": ""
      },
      {
        "bind": {
          "input": "checkbox"
        },
        "name": "Normalized",
        "value": false
      },
      {
        "name": "domainMax",
        "update": "if(Normalized,1,data('maxVals')[0].maximumValue)"
      }
    ],
    "title": "${string:title}"
  },
  "wandb/histogram/v0": {
    "$schema": "https://vega.github.io/schema/vega-lite/v4.json",
    "data": {
      "name": "wandb"
    },
    "description": "A simple histogram",
    "layer": [
      {
        "encoding": {
          "color": {
            "field": "newGroupKeys",
            "legend": {
              "title": null
            },
            "scale": {
              "range": {
                "field": "color"
              }
            },
            "type": "nominal"
          },
          "detail": [
            {
              "field": "newGroupKeys"
            },
            {
              "field": "color"
            }
          ],
          "opacity": {
            "value": 0.6
          },
          "x": {
            "bin": true,
            "field": "${field:value}",
            "type": "quantitative"
          },
          "y": {
            "aggregate": "count",
            "stack": null
          }
        },
        "mark": {
          "tooltip": {
            "content": "data"
          },
          "type": "bar"
        },
        "transform": [
          {
            "filter": "datum.grouped == false"
          }
        ]
      },
      {
        "encoding": {
          "color": {
            "field": "newGroupKeys",
            "legend": {
              "title": null
            },
            "scale": {
              "range": "category"
            },
            "type": "nominal"
          },
          "detail": [
            {
              "field": "newGroupKeys"
            },
            {
              "field": "color"
            }
          ],
          "opacity": {
            "value": 0.6
          },
          "x": {
            "bin": true,
            "field": "${field:value}",
            "type": "quantitative"
          },
          "y": {
            "aggregate": "count",
            "stack": true
          }
        },
        "mark": {
          "tooltip": {
            "content": "data"
          },
          "type": "bar"
        },
        "transform": [
          {
            "filter": "datum.grouped == true"
          }
        ]
      }
    ],
    "resolve": {
      "scale": {
        "color": "independent"
      }
    },
    "selection": {
      "grid": {
        "bind": "scales",
        "type": "interval"
      }
    },
    "title": "${string:title}",
    "transform": [
      {
        "as": "grouped",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', false, true)"
      },
      {
        "as": "newGroupKeys",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', datum.name, datum['${field:groupKeys}'])"
      },
      {
        "as": "color",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', datum.color, datum['${field:groupKeys}'])"
      },
      {
        "aggregate": [
          {
            "as": "${field:value}",
            "field": "${field:value}",
            "op": "average"
          }
        ],
        "groupby": [
          "newGroupKeys",
          "color",
          "grouped",
          "${field:value}"
        ]
      }
    ]
  },
  "wandb/line/v0": {
    "$schema": "https://vega.github.io/schema/vega-lite/v4.json",
    "data": {
      "name": "wandb"
    },
    "description": "A simple line plot",
    "encoding": {
      "x": {
        "field": "${field:x}",
        "type": "quantitative"
      }
    },
    "layer": [
      {
        "encoding": {
          "color": {
            "field": "name",
            "scale": {
              "range": {
                "field": "color"
              }
            },
            "type": "nominal"
          },
          "strokeDash": {
            "field": "${field:stroke}"
          },
          "y": {
            "field": "${field:y}",
            "type": "quantitative"
          }
        },
        "layer": [
          {
            "encoding": {
              "size": {
                "value": 0.5
              }
            },
            "mark": "line",
            "selection": {
              "grid": {
                "bind": "scales",
                "type": "interval"
              }
            }
          },
          {
            "mark": "point",
            "transform": [
              {
                "filter": {
                  "selection": "hover"
                }
              }
            ]
          }
        ]
      },
      {
        "encoding": {
          "opacity": {
            "condition": {
              "selection": "hover",
              "value": 3
            },
            "value": 0
          }
        },
        "mark": {
          "tooltip": {
            "content": "data"
          },
          "type": "rule"
        },
        "selection": {
          "hover": {
            "clear": "mouseout",
            "empty": "none",
            "fields": [
              "${field:x}"
            ],
            "nearest": true,
            "on": "mouseover",
            "type": "single"
          }
        },
        "transform": [
          {
            "groupby": [
              "${field:x}"
            ],
            "pivot": "name",
            "value": "${field:y}"
          }
        ]
      }
    ],
    "title": "${string:title}"
  },
  "wandb/lineseries/v0": {
    "$schema": "https://vega.github.io/schema/vega-lite/v4.json",
    "data": {
      "name": "wandb"
    },
    "description": "A plot for an arbitrary number of lines",
    "layer": [
      {
        "encoding": {
          "color": {
            "field": "name",
            "scale": {
              "range": {
                "field": "color"
              }
            },
            "type": "nominal"
          },
          "strokeDash": {
            "field": "${field:lineKey}",
            "type": "nominal"
          },
          "x": {
            "field": "${field:step}",
            "title": "${string:xname}",
            "type": "quantitative"
          },
          "y": {
            "field": "${field:lineVal}",
            "title": "y",
            "type": "quantitative"
          }
        },
        "mark": {
          "interpolate": "linear",
          "type": "line"
        },
        "selection": {
          "grid": {
            "bind": "scales",
            "type": "interval"
          }
        }
      }
    ],
    "title": "${string:title}",
    "transform": [
      {
        "filter": {
          "field": "${field:lineVal}",
          "valid": true
        }
      },
      {
        "filter": {
          "field": "${field:step}",
          "valid": true
        }
      }
    ]
  },
  "wandb/scatter/v0": {
    "$schema": "https://vega.github.io/schema/vega-lite/v4.json",
    "data": {
      "name": "wandb"
    },
    "description": "A simple scatter plot",
    "layer": [
      {
        "encoding": {
          "color": {
            "field": "${field:y}",
            "legend": {
              "title": "Gradient Color"
            },
            "scale": {
              "scheme": "reds"
            },
            "type": "quantitative"
          },
          "x": {
            "field": "${field:x}",
            "type": "quantitative"
          },
          "y": {
            "axis": {
              "title": false
            },
            "field": "${field:y}",
            "type": "quantitative"
          }
        },
        "mark": {
          "tooltip": {
            "content": "data"
          },
          "type": "circle"
        },
        "selection": {
          "grid1": {
            "bind": "scales",
            "type": "interval"
          }
        },
        "transform": [
          {
            "filter": "datum.grouped == false"
          }
        ]
      },
      {
        "encoding": {
          "color": {
            "field": "groupedY",
            "legend": {
              "title": "Degrading Color"
            },
            "scale": {
              "scheme": "inferno"
            },
            "type": "quantitative"
          },
          "x": {
            "field": "${field:x}",
            "type": "quantitative"
          },
          "y": {
            "axis": {
              "title": "${field:y}"
            },
            "field": "groupedY",
            "type": "quantitative"
          }
        },
        "mark": {
          "tooltip": {
            "content": "data"
          },
          "type": "circle"
        },
        "selection": {
          "grid0": {
            "bind": "scales",
            "type": "interval"
          }
        },
        "transform": [
          {
            "filter": "datum.grouped == true"
          }
        ]
      }
    ],
    "resolve": {
      "scale": {
        "color": "independent"
      }
    },
    "title": "${string:title}",
    "transform": [
      {
        "as": "grouped",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', false, true)"
      },
      {
        "as": "newGroupKeys",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', datum.name, datum['${field:groupKeys}'])"
      },
      {
        "as": "color",
        "calculate": "if('${field:groupKeys}' === ''  || datum['${field:groupKeys}'] === '', datum.color, datum['${field:groupKeys}'])"
      },
      {
        "groupby": [
          "${field:x}",
          "newGroupKeys",
          "color",
          "grouped"
        ],
        "joinaggregate": [
          {
            "as": "groupedY",
            "field": "${field:y}",
            "op": "average"
          }
        ]
      }
    ]
  }
};
