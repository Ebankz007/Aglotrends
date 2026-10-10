ALTER TABLE "broker_links" ADD CONSTRAINT "broker_links_url_unique" UNIQUE("url");--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_name_unique" UNIQUE("name");