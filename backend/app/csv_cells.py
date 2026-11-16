def spreadsheet_safe(value):
    """Keep user-controlled CSV text in a plain-text cell when opened in a spreadsheet."""
    if isinstance(value, str) and (value.startswith(("\t", "\r", "\n")) or
                                   value.lstrip().startswith(("=", "+", "-", "@", "＝", "＋", "－", "＠"))):
        return "'" + value
    return value
