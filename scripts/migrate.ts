import "../src/env.js";
import { migrator } from "../src/db/index.js";

const args = process.argv.slice(2);
const shouldRollback = args.includes("--rollback");

const migrate = async () => {
    if (shouldRollback) {
        const { error, results } = await migrator.migrateDown();

        results?.forEach((result) => {
            if (result.status === "Success") {
                console.log(
                    `Rollback of ${result.migrationName} was successful`
                );
            } else {
                console.error(`Rollback of ${result.migrationName} failed`);
            }
        });

        if (error) {
            console.error("Failed to rollback");
            console.error(error);
            process.exit(1);
        }

        return;
    }

    const { error, results } = await migrator.migrateToLatest();

    results?.forEach((result) => {
        if (result.status === "Success") {
            console.log(`Migration ${result.migrationName} was successful`);
        } else {
            console.error(`Migration ${result.migrationName} failed`);
        }
    });

    if (error) {
        console.error("Failed to migrate");
        console.error(error);
        process.exit(1);
    }
};

migrate();
