package eu.philbot;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.*;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

public class ShardsMaster {
    public static void main(String[] args) throws IOException {
        new Thread(new ShardUpdater(), "Shard Count Updater").start();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", Integer.parseInt(System.getenv("PORT"))), 10);
        server.createContext("/ping", ShardsMaster::servePing);
        server.createContext("/gateway/config", ShardsMaster::serveConfig);
    }

    private static void servePing(HttpExchange exchange) throws IOException {
        if (exchange.getRequestMethod() != "GET") {
            error(exchange, 405);
            return;
        }
        if (!exchange.getResponseHeaders().get("accept").contains("text/plain")) {
            error(exchange, 406);
            return;
        }
        String response = "pong";
        exchange.getResponseHeaders().add("content-type", "text/plain");
        exchange.sendResponseHeaders(200, response.length());
        writeResponseBody(exchange, response);
    }

    private static void serveConfig(HttpExchange exchange) throws IOException {
        if (exchange.getRequestMethod() != "POST") {
            error(exchange, 405);
            return;
        }
        if (!exchange.getResponseHeaders().get("accept").contains("text/plain")) {
            error(exchange, 406);
            return;
        }
        String response = computeNewConfig(new Config(readRequestBody(exchange))).toString();
        exchange.getResponseHeaders().add("content-type", "text/plain");
        exchange.sendResponseHeaders(200, response.length());
        writeResponseBody(exchange, response);
    }

    private static String readRequestBody(HttpExchange exchange) throws IOException {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(exchange.getRequestBody()))) {
            for (String line = reader.readLine(); line != null; line = reader.readLine()) {
                builder.append(line);
                builder.append("\n");
            }
        }
        return builder.toString().trim();
    }

    private static void writeResponseBody(HttpExchange exchange, String response) throws IOException {
        try (Writer writer = new OutputStreamWriter(exchange.getResponseBody())) {
            writer.write(response);
        }
    }

    private static void error(HttpExchange exchange, int error) throws IOException {
        exchange.sendResponseHeaders(error, 0);
        exchange.getResponseBody().close();
    }

    private static final Object LOCK = new Object();
    private static volatile int SHARD_COUNT = 0;
    private static volatile Config[] CONFIGS = new Config[0];

    private static class ShardUpdater implements Runnable {
        public void run() {
            while (true) {
                synchronized(LOCK) {
                    SHARD_COUNT = queryDesiredShardCount();
                    CONFIGS = Arrays.stream(CONFIGS).filter(config -> config.shard_count != SHARD_COUNT).toArray(Config[]::new);
                }
                try {
                    Thread.sleep(1000 * 60);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    private static int queryDesiredShardCount() {
        try {
            URL url = new URL("https://discord.com/api/v10/gateway/bot");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            // connection.setRequestProperty("Authorization", "Bot " + System.getenv("DISCORD_API_TOKEN"));
            connection.setRequestProperty("Authorization", "Bot OTI4OTI3NjEzMjY5OTg3MzY5.GwgLqg.HcoEjbcw2nbSLnZQqhhW6_BlikBbpMz0V1lnD8");
            StringBuilder builder = new StringBuilder();
            try (BufferedReader in = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                for (String line = in.readLine(); line != null; line = in.readLine()) {
                    builder.append(line);
                    builder.append("\n");
                }
            }
            String json = builder.toString().trim();
            String intro = "\"shards\":";
            int index = json.indexOf(intro) + intro.length();
            int count = 0;
            while (index < json.length() && Character.isDigit(json.charAt(index))) {
                count = count * 10 + (json.charAt(index) - '0');
                index += 1;
            }
            return count;
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    private static Config computeNewConfig(Config current) {
        synchronized (LOCK) {
            if (current.shard_index < 0 || current.shard_count < 0) {
                return createNewConfig(current.id);
            } else if (current.shard_count != SHARD_COUNT) {
                return createNewConfig(current.id);
            } else if (current.shard_count == SHARD_COUNT && Arrays.stream(CONFIGS).anyMatch(config -> config.id != current.id && current.shard_index == config.shard_index)) {
                return createNewConfig(current.id);
            } else {
                return current;
            }
        }
    }

    private static Config createNewConfig(String id) {
        synchronized(LOCK) {
            for (int shard_index = 0; shard_index < SHARD_COUNT; shard_index++) {
                final int final_shard_index = shard_index;
                if (Arrays.stream(CONFIGS).anyMatch(config -> config.shard_index == final_shard_index)) continue;
                Config newConfig = new Config(id, shard_index, SHARD_COUNT);
                List<Config> list = Arrays.stream(CONFIGS).filter(config -> config.id != newConfig.id).filter(config -> config.shard_index != newConfig.shard_index).collect(Collectors.toList());
                list.add(newConfig);
                CONFIGS = list.toArray(new Config[list.size()]);
                return newConfig;
            }
        }
        return new Config(id, -1, -1);
    }

    private static class Config {
        public final String id;
        public final int shard_index;
        public final int shard_count;

        public Config(String string) throws IOException {
            String[] tokens = string.split(";");
            if (tokens.length != 3) throw new IOException();
            this.id = tokens[0];
            this.shard_index = tokens[1] == "null" ? -1 : Integer.parseInt(tokens[1]);
            this.shard_count = tokens[2] == "null" ? -1 : Integer.parseInt(tokens[2]);
        }

        public Config(String id, int shard_index, int shard_count) {
            this.id = id;
            this.shard_index = shard_index;
            this.shard_count = shard_count;
        }

        @Override
        public String toString() {
            return id + ";" + (shard_index < 0 ? "null" : shard_index) + ";" + (shard_count < 0 ? "null" : shard_count);
        }
    }
}