# utils

Helper scripts that support working with the agent-harness repo. They're not
required at runtime — they're tools the maintainer uses to refresh data files,
inspect provider catalogs, and prepare configuration that other parts of the
repo consume.

## Prerequisites

The scripts target macOS and Linux with a POSIX-compatible shell. Install the
following before running anything in this folder:

| Tool       | Why it's needed                                       | Install                          |
| ---------- | ----------------------------------------------------- | -------------------------------- |
| `bash` 4+  | Shell used by the scripts                             | preinstalled on macOS / Linux    |
| `python3`  | JSON parsing and reshaping                            | `brew install python` / system   |
| `jq`       | Slim-output post-processing                           | `brew install jq`                |
| `opencode` | Source of the model catalog (`models.sh`)             | see the opencode docs            |

After cloning the repo, mark the scripts executable once:

```sh
chmod +x utils/*.sh
```

You can also invoke any script with `bash <script>` if you'd rather not set
the executable bit.

## Scripts

### `models.sh`

Pulls the live opencode model catalog (`opencode models --refresh --verbose`)
and reformats it into structured JSON. By default it writes a single
`temp/models-<DATE>.json` covering every provider, sorted by `release_date`
descending so the newest releases appear first. Pass `-p` to split the
catalog into one file per provider, optionally narrowed with `-p nvidia` or
`-p "[nvidia, openai]"`. Each rich file is paired with a slim companion
(`models-...-slim.json`) listing just keys and variant names; pass `-f`/`--free`
to restrict that slim file to models where `cost.input == 0`.

Run `./models.sh -h` (or `--help`) for the full usage reference. The same
content lives alongside the script in [`models.help.txt`](./models.help.txt).
