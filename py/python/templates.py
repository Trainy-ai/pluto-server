def process_run_email(
    run_name: str,
    project_name: str,
    last_update_time: str,
    time_diff_seconds: int,
    run_url: str,
    reason: str,
) -> str:
    return f"""<html>
<head>
    <style>
        body {{ 
            font-family: Arial, sans-serif; 
            line-height: 1.6; 
            color: #1a1a1a;
            background-color: #f5f5f5;
        }}
        .container {{ 
            max-width: 600px; 
            margin: 0 auto; 
            padding: 30px;
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        .header {{ 
            color: #1a1a1a; 
            font-size: 20px; 
            font-weight: bold;
            margin-bottom: 25px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e0e0e0;
        }}
        .details {{ 
            background-color: #f8f8f8; 
            padding: 20px; 
            border-radius: 6px; 
            margin: 20px 0;
            border: 1px solid #e0e0e0;
        }}
        .details p {{
            color: #1a1a1a;
            margin: 8px 0;
        }}
        .action {{ 
            margin-top: 25px;
            text-align: center;
        }}
        .button {{ 
            display: inline-block;
            padding: 12px 24px;
            background-color: #1a1a1a;
            color: #ffffff !important;
            text-decoration: none !important;
            border-radius: 6px;
            font-weight: bold;
            transition: all 0.2s ease;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border: none;
            cursor: pointer;
        }}
        .button:hover {{
            background-color: #444444;
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">⚠️ Run Status Alert</div>
        
        <div class="details">
            <p><strong>Run:</strong> {run_name}</p>
            <p><strong>Project:</strong> {project_name}</p>
            <p><strong>Last Seen (UTC):</strong> {last_update_time}</p>
            <p><strong>Estimated Time Since Last Update:</strong> {time_diff_seconds} seconds</p>
            <p><strong>Reason:</strong> {reason}</p>
        </div>

        <div class="action">
            <a href="{run_url}" class="button">
                View Run Details
            </a>
        </div>
    </div>
</body>
</html>"""
