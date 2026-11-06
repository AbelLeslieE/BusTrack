# GPS worker schedule and expected savings

BusTrack now uses two finite Cloud Run Jobs in Indian Standard Time instead of
one continuously allocated Cloud Run service.

## Schedule

| Worker | IST schedule | Provider polling |
| --- | --- | --- |
| Peak GPS worker | 07:00–09:15 and 16:15–19:15 | Every 10 seconds |
| Standby GPS worker | 09:00–20:00, excluding peak overlaps | Every 30 minutes |

The standby job also runs bounded telemetry retention. A separate 00:01 IST
trigger invokes that same job definition for the mandatory forward-direction
recovery and daily document reminders, without requesting provider GPS data.

Cloud Scheduler starts the jobs. The peak process exits at the end of its
current window, and the standby process exits after one pass. PostgreSQL uses
an advisory lock around each provider refresh so delayed or manual executions
cannot issue the same poll concurrently.

## Request-volume estimate

The previous production default refreshed providers every 20 seconds for all
24 hours:

- Previous: `86,400 / 20 = 4,320` provider refresh cycles per day.
- New peak periods: 5 hours 15 minutes at 10 seconds = `1,890` cycles per day.
- New standby periods: 16 non-overlapping scheduled polls per day.
- New total: `1,906` cycles per day.
- Reduction: `2,414` cycles, or **55.9% fewer provider refresh cycles**.

One refresh can make more than one upstream HTTP request when several provider
accounts or buses are configured, so exact HTTP-request savings depend on the
fleet. The proportional reduction remains approximately 55.9% for unchanged
provider configuration.

## Compute and database estimate

- The legacy worker reserved one instance for 24 hours per day.
- The peak worker is present for at most 5.25 hours per day.
- Standby work is billed only for its short executions. At an average of one
  minute for each of 25 Scheduler invocations (including the no-work 20:30
  boundary check), total worker allocation is about 5.67 hours per day:
  approximately **76.4% less worker instance time**.
- Direction recovery drops from a 10-second continuous loop (8,640 checks per
  day) to at most 26 scheduled checks per day: about **99.7% fewer checks**.
- Telemetry retention drops from every five minutes (288 runs per day) to 24
  scheduled runs per day: **91.7% fewer cleanup runs**.

Actual billing reduction also depends on Cloud SQL, Artifact Registry, network
egress, and public web traffic. This change removes the fixed 24-hour worker
allocation but does not claim the same percentage reduction for the entire GCP
invoice.
