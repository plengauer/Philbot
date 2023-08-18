FROM ruby:3.0
WORKDIR /application

COPY Gemfile ./
RUN bundle install
COPY ./lib/* ./

ENV SERVICE_NAME="Philbot Scheduler"
ENV SERVICE_VERSION=unknown
CMD exec ruby scheduler.rb
