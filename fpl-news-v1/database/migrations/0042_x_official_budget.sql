-- X official API bills returned posts and expanded users. Ten results per page bounds request cost.
INSERT INTO budgets (service, per_minute, per_hour, per_day, note)
VALUES ('x_api', 5, 20, 100, 'X 官方 API：按帖子及作者计费；每页默认 10 条，保留回执与调用熔断')
ON CONFLICT (service) DO NOTHING;
