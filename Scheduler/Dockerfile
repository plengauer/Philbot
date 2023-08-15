FROM ruby:3.0
WORKDIR /application

COPY Gemfile ./
RUN bundle install
copy ./lib/* ./

ENV SERVICE_NAME="Philbot Scheduler"
ENV SERVICE_VERSION=""
CMD exec ruby scheduler.rb
